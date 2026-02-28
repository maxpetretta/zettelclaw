import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ExtractedSession {
  at: string;
  entries: number;
}

export interface FailedSession {
  at: string;
  error: string;
  retries: number;
}

export interface ZettelclawState {
  extractedSessions: Record<string, ExtractedSession>;
  failedSessions: Record<string, FailedSession>;
}

function createEmptyState(): ZettelclawState {
  return {
    extractedSessions: {},
    failedSessions: {},
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function normalizeState(raw: unknown): ZettelclawState {
  if (!isObject(raw)) {
    return createEmptyState();
  }

  const extractedSessions: Record<string, ExtractedSession> = {};
  const failedSessions: Record<string, FailedSession> = {};

  const extractedRaw = isObject(raw.extractedSessions) ? raw.extractedSessions : {};
  const failedRaw = isObject(raw.failedSessions) ? raw.failedSessions : {};

  for (const [sessionId, sessionValue] of Object.entries(extractedRaw)) {
    if (!isObject(sessionValue)) {
      continue;
    }

    if (
      typeof sessionValue.at !== "string" ||
      !Number.isFinite(Date.parse(sessionValue.at)) ||
      typeof sessionValue.entries !== "number"
    ) {
      continue;
    }

    extractedSessions[sessionId] = {
      at: sessionValue.at,
      entries: sessionValue.entries,
    };
  }

  for (const [sessionId, sessionValue] of Object.entries(failedRaw)) {
    if (!isObject(sessionValue)) {
      continue;
    }

    if (
      typeof sessionValue.at !== "string" ||
      !Number.isFinite(Date.parse(sessionValue.at)) ||
      typeof sessionValue.error !== "string" ||
      typeof sessionValue.retries !== "number"
    ) {
      continue;
    }

    failedSessions[sessionId] = {
      at: sessionValue.at,
      error: sessionValue.error,
      retries: sessionValue.retries,
    };
  }

  return {
    extractedSessions,
    failedSessions,
  };
}

export async function readState(path: string): Promise<ZettelclawState> {
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return createEmptyState();
    }

    throw error;
  }

  return normalizeState(JSON.parse(raw));
}

export async function writeState(path: string, state: ZettelclawState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function markExtracted(
  path: string,
  sessionId: string,
  entryCount: number,
): Promise<void> {
  const state = await readState(path);

  state.extractedSessions[sessionId] = {
    at: new Date().toISOString(),
    entries: entryCount,
  };

  delete state.failedSessions[sessionId];
  await writeState(path, state);
}

export async function markFailed(path: string, sessionId: string, error: string): Promise<void> {
  const state = await readState(path);
  const previous = state.failedSessions[sessionId];

  state.failedSessions[sessionId] = {
    at: new Date().toISOString(),
    error,
    retries: (previous?.retries ?? 0) + 1,
  };

  await writeState(path, state);
}

export function isExtracted(state: ZettelclawState, sessionId: string): boolean {
  return Boolean(state.extractedSessions[sessionId]);
}

export function shouldRetry(state: ZettelclawState, sessionId: string): boolean {
  return (state.failedSessions[sessionId]?.retries ?? 0) < 2;
}

export async function pruneState(path: string, maxAgeDays = 30): Promise<void> {
  const state = await readState(path);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  for (const [sessionId, extracted] of Object.entries(state.extractedSessions)) {
    if (!Number.isFinite(Date.parse(extracted.at)) || Date.parse(extracted.at) < cutoff) {
      delete state.extractedSessions[sessionId];
    }
  }

  for (const [sessionId, failed] of Object.entries(state.failedSessions)) {
    if (!Number.isFinite(Date.parse(failed.at)) || Date.parse(failed.at) < cutoff) {
      delete state.failedSessions[sessionId];
    }
  }

  await writeState(path, state);
}
