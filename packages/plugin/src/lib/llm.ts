import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SubjectRegistry } from "../subjects/registry";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const EXTRACTION_PROMPT_PATH = join(THIS_DIR, "../../prompts/extraction.md");
const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:18789";

let extractionPromptCache: string | null = null;

async function loadExtractionPrompt(): Promise<string> {
  if (extractionPromptCache !== null) {
    return extractionPromptCache;
  }

  extractionPromptCache = await readFile(EXTRACTION_PROMPT_PATH, "utf8");
  return extractionPromptCache;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function formatSubjects(subjects: SubjectRegistry): string {
  const sortedEntries = Object.entries(subjects).sort(([left], [right]) => left.localeCompare(right));
  const sortedSubjects = Object.fromEntries(sortedEntries);
  return JSON.stringify(sortedSubjects, null, 2);
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

export async function extractFromTranscript(opts: {
  transcript: string;
  subjects: SubjectRegistry;
  model: string;
  apiBaseUrl?: string;
  apiToken?: string;
}): Promise<string> {
  const prompt = await loadExtractionPrompt();
  const baseUrl = normalizeBaseUrl(opts.apiBaseUrl ?? process.env.OPENCLAW_GATEWAY_URL ?? DEFAULT_GATEWAY_BASE_URL);

  const userPrompt = [
    "## Known subjects",
    formatSubjects(opts.subjects),
    "",
    "## Transcript",
    opts.transcript,
  ].join("\n");

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (opts.apiToken) {
    headers.authorization = `Bearer ${opts.apiToken}`;
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts.model,
      temperature: 0,
      stream: false,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`extraction LLM call failed: ${await parseErrorBody(response)}`);
  }

  const payload = (await response.json()) as unknown;
  return extractCompletionText(payload);
}
