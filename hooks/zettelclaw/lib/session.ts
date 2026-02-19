import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

interface SessionEventLike {
  sessionKey: string;
  context?: {
    sessionFile?: string;
    workspaceDir?: string;
    sessionId?: string;
  };
}

function normalizeRole(value: unknown): "user" | "assistant" | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized === "user" || normalized === "human") {
    return "user";
  }

  if (normalized === "assistant" || normalized === "ai" || normalized === "model") {
    return "assistant";
  }

  return null;
}

function contentToText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => contentToText(item))
      .filter((item) => item.length > 0)
      .join("\n")
      .trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const directText = typeof record.text === "string" ? record.text : "";
  if (directText.trim().length > 0) {
    return directText.trim();
  }

  if ("content" in record) {
    const nested = contentToText(record.content);
    if (nested.length > 0) {
      return nested;
    }
  }

  if ("value" in record) {
    const nested = contentToText(record.value);
    if (nested.length > 0) {
      return nested;
    }
  }

  return "";
}

function extractTurn(rawEntry: unknown): ConversationTurn | null {
  if (!rawEntry || typeof rawEntry !== "object") {
    return null;
  }

  const queue: Record<string, unknown>[] = [rawEntry as Record<string, unknown>];
  const visited = new Set<Record<string, unknown>>();

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate || visited.has(candidate)) {
      continue;
    }

    visited.add(candidate);

    const role = normalizeRole(candidate.role ?? candidate.speaker ?? candidate.author);
    const content = contentToText(
      candidate.content ?? candidate.text ?? candidate.message ?? candidate.output ?? candidate.value,
    );

    if (role && content.length > 0) {
      return { role, content };
    }

    for (const nestedKey of ["message", "payload", "data", "entry", "event"]) {
      const nestedValue = candidate[nestedKey];
      if (nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
        queue.push(nestedValue as Record<string, unknown>);
      }
    }
  }

  return null;
}

async function readSessionTurns(pathToSession: string): Promise<ConversationTurn[]> {
  try {
    const raw = await readFile(pathToSession, "utf8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const turns: ConversationTurn[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const turn = extractTurn(parsed);
        if (turn) {
          turns.push(turn);
        }
      } catch {
        // Ignore malformed lines and keep scanning.
      }
    }

    return turns;
  } catch {
    return [];
  }
}

function resolveSessionFile(event: SessionEventLike): string | null {
  const sessionFile = event.context?.sessionFile;
  if (typeof sessionFile === "string" && sessionFile.trim().length > 0) {
    return resolve(sessionFile);
  }

  const workspaceDir = event.context?.workspaceDir;
  if (typeof workspaceDir === "string" && workspaceDir.trim().length > 0) {
    const sessionId = event.context?.sessionId ?? event.sessionKey;
    if (typeof sessionId === "string" && sessionId.length > 0) {
      return resolve(join(workspaceDir, "sessions", `${sessionId}.jsonl`));
    }
  }

  return null;
}

async function findResetFiles(pathToSession: string): Promise<string[]> {
  try {
    const dir = dirname(pathToSession);
    const baseName = basename(pathToSession);
    const entries = await readdir(dir, { withFileTypes: true });

    const matched = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(`${baseName}.reset.`))
      .map((entry) => join(dir, entry.name));

    const withMtime = await Promise.all(
      matched.map(async (path) => ({
        path,
        mtime: (await stat(path)).mtimeMs,
      })),
    );

    withMtime.sort((a, b) => b.mtime - a.mtime);
    return withMtime.map((entry) => entry.path);
  } catch {
    return [];
  }
}

export async function readRecentSessionMessages(
  event: SessionEventLike,
  maxMessages: number,
): Promise<ConversationTurn[]> {
  const sessionFile = resolveSessionFile(event);
  if (!sessionFile) {
    return [];
  }

  const candidates = [sessionFile, ...(await findResetFiles(sessionFile))];
  let fallback: ConversationTurn[] = [];

  for (const candidate of candidates) {
    const turns = await readSessionTurns(candidate);
    if (turns.length >= 2) {
      return turns.slice(-maxMessages);
    }

    if (turns.length > fallback.length) {
      fallback = turns;
    }
  }

  return fallback.slice(-maxMessages);
}
