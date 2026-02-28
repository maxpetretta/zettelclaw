import { join } from "node:path";
import type { AnyAgentTool, OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../config";
import { queryLog } from "../log/query";
import { findTranscriptFile, readTranscript } from "../lib/transcript";

interface MemoryGetParams {
  path?: string;
  from?: number;
  lines?: number;
}

interface MemoryGetDeps {
  queryLog: typeof queryLog;
  findTranscriptFile: typeof findTranscriptFile;
  readTranscript: typeof readTranscript;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;

const DEFAULT_DEPS: MemoryGetDeps = {
  queryLog,
  findTranscriptFile,
  readTranscript,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textResult(text: string, details?: unknown): { content: Array<{ type: string; text: string }>; details?: unknown } {
  return {
    content: [{ type: "text", text }],
    ...(details === undefined ? {} : { details }),
  };
}

function buildParametersSchema(baseParameters: unknown): Record<string, unknown> {
  if (!isObject(baseParameters)) {
    return {
      type: "object",
      properties: {
        path: { type: "string" },
        from: { type: "number" },
        lines: { type: "number" },
      },
      required: ["path"],
      additionalProperties: false,
    };
  }

  return {
    ...baseParameters,
    type: "object",
  };
}

function resolveAgentId(ctx: OpenClawPluginToolContext): string | undefined {
  if (ctx.agentId && ctx.agentId.trim()) {
    return ctx.agentId.trim();
  }

  const sessionKey = ctx.sessionKey?.trim();
  if (!sessionKey) {
    return undefined;
  }

  const parts = sessionKey.split(":");
  if (parts.length >= 2 && parts[0] === "agent" && parts[1]?.trim()) {
    return parts[1].trim();
  }

  return undefined;
}

export function createWrappedMemoryGetTool(
  api: OpenClawPluginApi,
  ctx: OpenClawPluginToolContext,
  config: PluginConfig,
  deps: Partial<MemoryGetDeps> = {},
): AnyAgentTool {
  const resolvedDeps: MemoryGetDeps = {
    ...DEFAULT_DEPS,
    ...deps,
  };

  const builtin = api.runtime.tools.createMemoryGetTool({
    config: ctx.config,
    agentSessionKey: ctx.sessionKey,
  });

  const builtinExecute =
    builtin && typeof builtin.execute === "function"
      ? builtin.execute.bind(builtin)
      : null;

  const logPath = join(config.logDir, "log.jsonl");

  return {
    name: "memory_get",
    label: builtin?.label ?? "Memory Get",
    description: "Get memory files, log entries by id, or session transcripts.",
    parameters: buildParametersSchema(builtin?.parameters),
    async execute(
      toolCallId: string,
      rawParams: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: unknown,
      runtimeCtx?: unknown,
    ) {
      const params = rawParams as MemoryGetParams;
      const path = typeof params.path === "string" ? params.path.trim() : "";

      if (!path) {
        return textResult("Path is required.");
      }

      if (ID_PATTERN.test(path)) {
        const entries = await resolvedDeps.queryLog(logPath, { includeReplaced: true });
        const entry = entries.find((candidate) => candidate.id === path);

        if (!entry) {
          return textResult(`Entry not found: ${path}`);
        }

        return textResult(JSON.stringify(entry, null, 2), { entry });
      }

      if (path.startsWith("session:")) {
        const sessionId = path.slice("session:".length).trim();
        if (!sessionId) {
          return textResult("Session not found");
        }

        const agentId = resolveAgentId(ctx);
        if (!agentId) {
          return textResult(`Session not found: ${sessionId}`);
        }

        const transcriptPath = await resolvedDeps.findTranscriptFile(agentId, sessionId);
        if (!transcriptPath) {
          return textResult(`Session not found: ${sessionId}`);
        }

        const messages = await resolvedDeps.readTranscript(transcriptPath);
        const transcript = messages
          .map((message) => `${message.timestamp} ${message.role}: ${message.content}`)
          .join("\n");

        if (!transcript.trim()) {
          return textResult(`Session not found: ${sessionId}`);
        }

        return textResult(transcript, {
          sessionId,
          transcriptPath,
        });
      }

      if (!builtinExecute) {
        return textResult("Builtin memory_get is unavailable.");
      }

      return await builtinExecute(
        toolCallId,
        {
          path,
          ...(typeof params.from === "number" ? { from: params.from } : {}),
          ...(typeof params.lines === "number" ? { lines: params.lines } : {}),
        },
        signal,
        onUpdate,
        runtimeCtx,
      );
    },
  } as AnyAgentTool;
}
