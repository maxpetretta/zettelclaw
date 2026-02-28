import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeEntry, validateLlmOutput, type LogEntry } from "../log/schema";
import { ensureSubject, readRegistry, type SubjectRegistry } from "../subjects/registry";
import type { ImportedConversation } from "./types";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const EXTRACTION_PROMPT_PATH = join(THIS_DIR, "../../prompts/extraction.md");
const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:18789";

const HISTORICAL_SYSTEM_PREFIX = [
  "Historical import mode:",
  "- The transcript is archived historical data imported from another platform.",
  "- Extract durable memory exactly as written, without assuming current status.",
  "- The hook will pin all entry timestamps to the conversation's historical updatedAt time.",
].join("\n");

let extractionPromptCache: string | null = null;

export interface ImportExtractionOptions {
  conversation: ImportedConversation;
  sessionId: string;
  subjectsPath: string;
  model: string;
  apiBaseUrl?: string;
  apiToken?: string;
  ensureSubjects?: boolean;
}

interface CallModelParams {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiBaseUrl?: string;
  apiToken?: string;
}

export interface ImportExtractionDeps {
  callModel: (params: CallModelParams) => Promise<string>;
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
    throw new Error("invalid LLM response payload");
  }

  const payload = raw as Record<string, unknown>;
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("LLM response missing choices");
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    throw new Error("LLM response contained an invalid choice");
  }

  const message = (firstChoice as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    throw new Error("LLM response choice missing message");
  }

  const content = (message as Record<string, unknown>).content;
  const text = extractTextFromChatContent(content).trim();
  if (!text) {
    throw new Error("LLM response did not include text content");
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

async function defaultCallModel(params: CallModelParams): Promise<string> {
  const baseUrl = normalizeBaseUrl(
    params.apiBaseUrl ?? process.env.OPENCLAW_GATEWAY_URL ?? DEFAULT_GATEWAY_BASE_URL,
  );

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (params.apiToken) {
    headers.authorization = `Bearer ${params.apiToken}`;
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: params.model,
      temperature: 0,
      stream: false,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`extraction LLM call failed: ${await parseErrorBody(response)}`);
  }

  return extractCompletionText((await response.json()) as unknown);
}

const DEFAULT_DEPS: ImportExtractionDeps = {
  callModel: defaultCallModel,
};

async function loadExtractionPrompt(): Promise<string> {
  if (extractionPromptCache !== null) {
    return extractionPromptCache;
  }

  extractionPromptCache = await readFile(EXTRACTION_PROMPT_PATH, "utf8");
  return extractionPromptCache;
}

function formatSubjects(subjects: SubjectRegistry): string {
  const sortedEntries = Object.entries(subjects).sort(([left], [right]) => left.localeCompare(right));
  const sortedSubjects = Object.fromEntries(sortedEntries);
  return JSON.stringify(sortedSubjects, null, 2);
}

function formatTranscript(conversation: ImportedConversation): string {
  return conversation.messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}

export async function extractImportedConversation(
  options: ImportExtractionOptions,
  deps: Partial<ImportExtractionDeps> = {},
): Promise<LogEntry[]> {
  const runtimeDeps: ImportExtractionDeps = {
    ...DEFAULT_DEPS,
    ...deps,
  };

  const prompt = await loadExtractionPrompt();
  const subjects = await readRegistry(options.subjectsPath);
  const systemPrompt = `${HISTORICAL_SYSTEM_PREFIX}\n\n${prompt.trim()}`;
  const userPrompt = [
    "## Known subjects",
    formatSubjects(subjects),
    "",
    "## Transcript",
    formatTranscript(options.conversation),
  ].join("\n");

  const rawOutput = await runtimeDeps.callModel({
    model: options.model,
    systemPrompt,
    userPrompt,
    apiBaseUrl: options.apiBaseUrl,
    apiToken: options.apiToken,
  });

  const entries: LogEntry[] = [];
  for (const line of rawOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const validated = validateLlmOutput(parsed);
    if (!validated.ok) {
      continue;
    }

    const finalized = finalizeEntry(validated.entry, {
      sessionId: options.sessionId,
      timestamp: options.conversation.updatedAt,
    });

    if (finalized.subject && options.ensureSubjects !== false) {
      await ensureSubject(options.subjectsPath, finalized.subject);
    }

    entries.push(finalized);
  }

  return entries;
}
