import { join } from "node:path";
import type { AnyAgentTool, OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../config";
import { queryLog, searchLog, type LogQueryFilter } from "../log/query";
import type { EntryType, LogEntry } from "../log/schema";

interface SearchParams {
  query?: string;
  maxResults?: number;
  minScore?: number;
  type?: string;
  subject?: string;
  status?: string;
  includeReplaced?: boolean;
}

interface MemorySearchDeps {
  queryLog: typeof queryLog;
  searchLog: typeof searchLog;
}

const ENTRY_TYPE_SET = new Set<EntryType>(["task", "fact", "decision", "question", "handoff"]);
const STATUS_SET = new Set(["open", "done"]);

const DEFAULT_DEPS: MemorySearchDeps = {
  queryLog,
  searchLog,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeQuery(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeEntryType(value: unknown): EntryType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return ENTRY_TYPE_SET.has(value as EntryType) ? (value as EntryType) : undefined;
}

function normalizeStatus(value: unknown): "open" | "done" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return STATUS_SET.has(value) ? (value as "open" | "done") : undefined;
}

function normalizeSubject(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function extractTextFromToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  if (!isObject(result)) {
    return "";
  }

  const content = result.content;
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (!isObject(item)) {
          return "";
        }

        return typeof item.text === "string" ? item.text : "";
      })
      .filter((text) => text.length > 0);

    return parts.join("\n").trim();
  }

  return "";
}

function textResult(text: string, details?: unknown): { content: Array<{ type: string; text: string }>; details?: unknown } {
  return {
    content: [{ type: "text", text }],
    ...(details === undefined ? {} : { details }),
  };
}

function formatLogEntry(entry: LogEntry): string {
  const subject = entry.subject ?? "general";
  return `[${entry.type}] ${subject} — ${entry.content} (${entry.timestamp})`;
}

function dedupeEntries(entries: LogEntry[]): LogEntry[] {
  const seen = new Set<string>();
  const output: LogEntry[] = [];

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }

    seen.add(entry.id);
    output.push(entry);
  }

  return output;
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function buildStructuredFilter(params: SearchParams): { filter: LogQueryFilter; hasStructuredFilters: boolean } {
  const type = normalizeEntryType(params.type);
  const subject = normalizeSubject(params.subject);
  const status = normalizeStatus(params.status);
  const includeReplaced = normalizeBoolean(params.includeReplaced) ?? false;

  return {
    filter: {
      ...(type ? { type } : {}),
      ...(subject ? { subject } : {}),
      ...(status ? { status } : {}),
      includeReplaced,
    },
    hasStructuredFilters: Boolean(type || subject || status),
  };
}

function buildParametersSchema(baseParameters: unknown): Record<string, unknown> {
  if (!isObject(baseParameters)) {
    return {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" },
        minScore: { type: "number" },
        type: { type: "string" },
        subject: { type: "string" },
        status: { type: "string", enum: ["open", "done"] },
        includeReplaced: { type: "boolean" },
      },
      additionalProperties: false,
    };
  }

  const existingProperties = isObject(baseParameters.properties) ? baseParameters.properties : {};

  return {
    ...baseParameters,
    type: "object",
    properties: {
      ...existingProperties,
      type: { type: "string", enum: ["task", "fact", "decision", "question", "handoff"] },
      subject: { type: "string" },
      status: { type: "string", enum: ["open", "done"] },
      includeReplaced: { type: "boolean" },
    },
  };
}

export function createWrappedMemorySearchTool(
  api: OpenClawPluginApi,
  ctx: OpenClawPluginToolContext,
  config: PluginConfig,
  deps: Partial<MemorySearchDeps> = {},
): AnyAgentTool {
  const resolvedDeps: MemorySearchDeps = {
    ...DEFAULT_DEPS,
    ...deps,
  };

  const builtin = api.runtime.tools.createMemorySearchTool({
    config: ctx.config,
    agentSessionKey: ctx.sessionKey,
  });

  const builtinExecute =
    builtin && typeof builtin.execute === "function"
      ? builtin.execute.bind(builtin)
      : null;

  const logPath = join(config.logDir, "log.jsonl");

  return {
    name: "memory_search",
    label: builtin?.label ?? "Memory Search",
    description:
      "Search memory with semantic query support and structured log filters (type, subject, task status).",
    parameters: buildParametersSchema(builtin?.parameters),
    async execute(
      toolCallId: string,
      rawParams: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: unknown,
      runtimeCtx?: unknown,
    ) {
      const params = rawParams as SearchParams;
      const query = normalizeQuery(params.query);
      const { filter, hasStructuredFilters } = buildStructuredFilter(params);

      if (!query && !hasStructuredFilters) {
        return textResult("No results.", { reason: "missing query and structured filters" });
      }

      const [structuredEntries, fallbackKeywordEntries, builtinResult] = await Promise.all([
        hasStructuredFilters ? resolvedDeps.queryLog(logPath, filter) : Promise.resolve([]),
        query && !builtinExecute ? resolvedDeps.searchLog(logPath, query, filter) : Promise.resolve([]),
        query && builtinExecute
          ? builtinExecute(
              toolCallId,
              {
                query,
                ...(typeof params.maxResults === "number" ? { maxResults: params.maxResults } : {}),
                ...(typeof params.minScore === "number" ? { minScore: params.minScore } : {}),
              },
              signal,
              onUpdate,
              runtimeCtx,
            )
          : Promise.resolve(null),
      ]);

      const logEntries = dedupeEntries([...structuredEntries, ...fallbackKeywordEntries]);

      // Query-only requests should preserve builtin behavior when available.
      if (query && !hasStructuredFilters && builtinResult) {
        return builtinResult;
      }

      const logLines = logEntries.map(formatLogEntry);
      const builtinText = extractTextFromToolResult(builtinResult);

      const mergedLines = dedupeLines([
        ...logLines,
        ...builtinText.split("\n"),
      ]);

      if (mergedLines.length === 0) {
          return textResult("No results.", {
          logMatches: logEntries.length,
          semanticMatches: builtinText ? 1 : 0,
        });
      }

      return textResult(mergedLines.join("\n"), {
        logEntries,
      });
    },
  } as AnyAgentTool;
}
