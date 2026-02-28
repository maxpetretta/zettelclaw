import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TranscriptMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

function resolveOpenClawHome(): string {
  const override = process.env.OPENCLAW_HOME?.trim();
  if (override) {
    return override;
  }

  return join(homedir(), ".openclaw");
}

function normalizeText(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return normalizeText(content);
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];

  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const block = item as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "";
    const textValue = block.text;
    const inputTextValue = block.input_text;

    if ((type === "text" || type === "input_text") && typeof textValue === "string") {
      const normalized = normalizeText(textValue);
      if (normalized) {
        parts.push(normalized);
      }
      continue;
    }

    if (typeof inputTextValue === "string") {
      const normalized = normalizeText(inputTextValue);
      if (normalized) {
        parts.push(normalized);
      }
    }
  }

  return parts.join("\n");
}

function isUserAssistantRole(value: unknown): value is "user" | "assistant" {
  return value === "user" || value === "assistant";
}

function parseMessageLine(line: string): TranscriptMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (record.type !== "message") {
    return null;
  }

  const messageValue = record.message;
  if (!messageValue || typeof messageValue !== "object") {
    return null;
  }

  const message = messageValue as Record<string, unknown>;
  if (!isUserAssistantRole(message.role)) {
    return null;
  }

  const content = extractTextFromContent(message.content);
  if (!content) {
    return null;
  }

  const timestamp =
    typeof record.timestamp === "string"
      ? record.timestamp
      : typeof message.timestamp === "string"
        ? message.timestamp
        : new Date(0).toISOString();

  return {
    role: message.role,
    content,
    timestamp,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isResetVariant(name: string, sessionId: string): boolean {
  return (
    (name.startsWith(`${sessionId}.reset.`) && name.endsWith(".jsonl")) ||
    name.startsWith(`${sessionId}.jsonl.reset.`)
  );
}

export async function readTranscript(sessionFile: string): Promise<TranscriptMessage[]> {
  const content = await readFile(sessionFile, "utf8");
  const messages: TranscriptMessage[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const message = parseMessageLine(trimmed);
    if (message) {
      messages.push(message);
    }
  }

  return messages;
}

export async function findTranscriptFile(agentId: string, sessionId: string): Promise<string | null> {
  if (!agentId || !sessionId) {
    return null;
  }

  const sessionsDir = join(resolveOpenClawHome(), "agents", agentId, "sessions");
  const primaryPath = join(sessionsDir, `${sessionId}.jsonl`);

  if (await pathExists(primaryPath)) {
    return primaryPath;
  }

  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return null;
  }

  const candidates = files.filter((name) => isResetVariant(name, sessionId));
  if (candidates.length === 0) {
    return null;
  }

  let latestPath: string | null = null;
  let latestMtime = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const candidatePath = join(sessionsDir, candidate);
    try {
      const fileStat = await stat(candidatePath);
      if (fileStat.mtimeMs > latestMtime) {
        latestMtime = fileStat.mtimeMs;
        latestPath = candidatePath;
      }
    } catch {
      // Ignore missing/deleted files while sweeping candidates.
    }
  }

  return latestPath;
}

export function formatTranscript(messages: TranscriptMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n");
}
