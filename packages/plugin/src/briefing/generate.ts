import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginConfig } from "../config";
import { filterReplaced } from "../log/resolve";
import { readLog, type LogEntry } from "../log/schema";

export const BRIEFING_BEGIN_MARKER = "<!-- BEGIN GENERATED BRIEFING -->";
export const BRIEFING_END_MARKER = "<!-- END GENERATED BRIEFING -->";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const BRIEFING_PROMPT_PATH = join(THIS_DIR, "../../prompts/briefing.md");
const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:18789";

interface BriefingDeps {
  callBriefingModel: (opts: {
    prompt: string;
    model: string;
    apiBaseUrl?: string;
    apiToken?: string;
    userInput: string;
  }) => Promise<string>;
  readMemoryFile: (path: string) => Promise<string>;
  writeMemoryFile: (path: string, content: string) => Promise<void>;
}

let promptCache: string | null = null;

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function extractTextFromChatContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const textParts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const record = part as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";

    if ((type === "text" || type === "input_text") && typeof record.text === "string") {
      textParts.push(record.text);
      continue;
    }

    if (typeof record.input_text === "string") {
      textParts.push(record.input_text);
    }
  }

  return textParts.join("\n");
}

function extractCompletionText(raw: unknown): string {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid briefing LLM response payload");
  }

  const payload = raw as Record<string, unknown>;
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("briefing LLM response missing choices");
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    throw new Error("briefing LLM response contained an invalid choice");
  }

  const message = (firstChoice as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    throw new Error("briefing LLM response choice missing message");
  }

  const content = (message as Record<string, unknown>).content;
  const text = extractTextFromChatContent(content).trim();
  if (!text) {
    throw new Error("briefing LLM response did not include text content");
  }

  return text;
}

async function parseErrorBody(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) {
    return `${response.status} ${response.statusText}`;
  }

  return `${response.status} ${response.statusText}: ${text}`;
}

async function loadPrompt(): Promise<string> {
  if (promptCache !== null) {
    return promptCache;
  }

  promptCache = await readFile(BRIEFING_PROMPT_PATH, "utf8");
  return promptCache;
}

function formatEntry(entry: LogEntry): string {
  const parts = [`[${entry.timestamp}]`, entry.type];

  if (entry.subject) {
    parts.push(`subject=${entry.subject}`);
  }

  if (entry.type === "task") {
    parts.push(`status=${entry.status}`);
  }

  parts.push(`content=${entry.content}`);

  if (entry.detail) {
    parts.push(`detail=${entry.detail}`);
  }

  parts.push(`session=${entry.session}`);

  return `- ${parts.join(" | ")}`;
}

function extractGeneratedBlock(memoryContent: string): string {
  const start = memoryContent.indexOf(BRIEFING_BEGIN_MARKER);
  const end = memoryContent.indexOf(BRIEFING_END_MARKER);

  if (start < 0 || end < 0 || end <= start) {
    return "";
  }

  const from = start + BRIEFING_BEGIN_MARKER.length;
  return memoryContent.slice(from, end).trim();
}

function limitLines(content: string, maxLines: number): string {
  const lines = content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 || line === "");

  return lines.slice(0, maxLines).join("\n").trim();
}

function applyGeneratedBlock(memoryContent: string, generated: string): string {
  const start = memoryContent.indexOf(BRIEFING_BEGIN_MARKER);
  const end = memoryContent.indexOf(BRIEFING_END_MARKER);

  if (start >= 0 && end >= 0 && end > start) {
    const before = memoryContent.slice(0, start + BRIEFING_BEGIN_MARKER.length).replace(/\s*$/u, "");
    const after = memoryContent.slice(end).replace(/^\s*/u, "");

    return `${before}\n${generated}\n${after}`.replace(/\n{3,}/gu, "\n\n");
  }

  const trimmed = memoryContent.trimEnd();
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
  return `${prefix}${BRIEFING_BEGIN_MARKER}\n${generated}\n${BRIEFING_END_MARKER}\n`;
}

const DEFAULT_DEPS: BriefingDeps = {
  async callBriefingModel(opts) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (opts.apiToken) {
      headers.authorization = `Bearer ${opts.apiToken}`;
    }

    const baseUrl = normalizeBaseUrl(
      opts.apiBaseUrl ?? process.env.OPENCLAW_GATEWAY_URL ?? DEFAULT_GATEWAY_BASE_URL,
    );

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        stream: false,
        messages: [
          { role: "system", content: opts.prompt },
          { role: "user", content: opts.userInput },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`briefing LLM call failed: ${await parseErrorBody(response)}`);
    }

    return extractCompletionText(await response.json());
  },
  async readMemoryFile(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isEnoent(error)) {
        return "";
      }

      throw error;
    }
  },
  async writeMemoryFile(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  },
};

export async function generateBriefing(
  opts: {
    logPath: string;
    memoryMdPath: string;
    config: PluginConfig;
    apiBaseUrl?: string;
    apiToken?: string;
  },
  deps: Partial<BriefingDeps> = {},
): Promise<void> {
  const resolvedDeps: BriefingDeps = {
    ...DEFAULT_DEPS,
    ...deps,
  };

  const prompt = await loadPrompt();
  const allEntries = await readLog(opts.logPath);
  const entries = filterReplaced(allEntries);
  const memoryContent = await resolvedDeps.readMemoryFile(opts.memoryMdPath);
  const currentGenerated = extractGeneratedBlock(memoryContent);

  const logText = entries.map(formatEntry).join("\n") || "- n/a";

  const userInput = [
    "## Current Generated Block",
    currentGenerated || "(empty)",
    "",
    "## Entries",
    logText,
    "",
    `Constraints: activeWindow=${opts.config.briefing.activeWindow}, decisionWindow=${opts.config.briefing.decisionWindow}, staleThreshold=${opts.config.briefing.staleThreshold}, maxLines=${opts.config.briefing.maxLines}`,
  ].join("\n");

  const rawGenerated = await resolvedDeps.callBriefingModel({
    prompt,
    model: opts.config.briefing.model,
    apiBaseUrl: opts.apiBaseUrl,
    apiToken: opts.apiToken,
    userInput,
  });

  const generated = limitLines(rawGenerated, opts.config.briefing.maxLines);
  const updatedMemory = applyGeneratedBlock(memoryContent, generated);

  await resolvedDeps.writeMemoryFile(opts.memoryMdPath, updatedMemory);
}

export const __briefingTestExports = {
  applyGeneratedBlock,
  extractGeneratedBlock,
  limitLines,
};
