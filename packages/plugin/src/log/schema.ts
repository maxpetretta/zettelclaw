import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { nanoid } from "nanoid";

export const ENTRY_TYPES = ["task", "fact", "decision", "question", "handoff"] as const;

export type EntryType = (typeof ENTRY_TYPES)[number];

interface BaseEntry {
  id: string;
  timestamp: string;
  type: EntryType;
  content: string;
  session: string;
  detail?: string;
  subject?: string;
  replaces?: string;
}

export interface TaskEntry extends BaseEntry {
  type: "task";
  status: "open" | "done";
}

interface FactEntry extends BaseEntry {
  type: "fact";
}

interface DecisionEntry extends BaseEntry {
  type: "decision";
}

interface QuestionEntry extends BaseEntry {
  type: "question";
}

interface HandoffEntry extends BaseEntry {
  type: "handoff";
}

export type LogEntry = TaskEntry | FactEntry | DecisionEntry | QuestionEntry | HandoffEntry;

const COMMON_REQUIRED_FIELDS = ["content", "type"] as const;
const COMMON_OPTIONAL_FIELDS = ["detail", "subject", "replaces"] as const;
const VALID_STATUS = new Set(["open", "done"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.includes("T");
}

function hasOnlyAllowedKeys(raw: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(raw).every((key) => allowed.has(key));
}

function validateCommonTextFields(raw: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  for (const field of COMMON_REQUIRED_FIELDS) {
    if (!isNonEmptyString(raw[field])) {
      return { ok: false, error: `${field} must be a non-empty string` };
    }
  }

  for (const field of COMMON_OPTIONAL_FIELDS) {
    const value = raw[field];
    if (value !== undefined && !isNonEmptyString(value)) {
      return { ok: false, error: `${field} must be a non-empty string when provided` };
    }
  }

  return { ok: true };
}

function parseType(rawType: unknown): EntryType | undefined {
  if (typeof rawType !== "string") {
    return undefined;
  }

  return ENTRY_TYPES.find((entryType) => entryType === rawType);
}

function buildLlmEntry(
  raw: Record<string, unknown>,
): { ok: true; entry: Omit<LogEntry, "id" | "timestamp" | "session"> } | { ok: false; error: string } {
  const type = parseType(raw.type);
  if (!type) {
    return { ok: false, error: "type must be one of task, fact, decision, question, handoff" };
  }

  const commonValidation = validateCommonTextFields(raw);
  if (!commonValidation.ok) {
    return commonValidation;
  }

  const content = raw.content as string;
  const detail = raw.detail as string | undefined;
  const subject = raw.subject as string | undefined;
  const replaces = raw.replaces as string | undefined;

  if (type === "task") {
    const status = raw.status;
    if (typeof status !== "string" || !VALID_STATUS.has(status)) {
      return { ok: false, error: "task.status must be \"open\" or \"done\"" };
    }

    return {
      ok: true,
      entry: {
        type,
        content,
        status,
        ...(detail ? { detail } : {}),
        ...(subject ? { subject } : {}),
        ...(replaces ? { replaces } : {}),
      },
    };
  }

  return {
    ok: true,
    entry: {
      type,
      content,
      ...(detail ? { detail } : {}),
      ...(subject ? { subject } : {}),
      ...(replaces ? { replaces } : {}),
    },
  };
}

export function generateId(): string {
  return nanoid(12);
}

export function validateEntry(raw: unknown): { ok: true; entry: LogEntry } | { ok: false; error: string } {
  if (!isObject(raw)) {
    return { ok: false, error: "entry must be an object" };
  }

  const allowedKeys = new Set([
    "id",
    "timestamp",
    "type",
    "content",
    "session",
    "detail",
    "subject",
    "replaces",
    "status",
  ]);

  if (!hasOnlyAllowedKeys(raw, allowedKeys)) {
    return { ok: false, error: "entry contains unsupported fields" };
  }

  if (!isNonEmptyString(raw.id) || raw.id.length !== 12) {
    return { ok: false, error: "id must be a 12-character string" };
  }

  if (!isNonEmptyString(raw.timestamp) || !isIsoTimestamp(raw.timestamp)) {
    return { ok: false, error: "timestamp must be a valid ISO 8601 string" };
  }

  if (!isNonEmptyString(raw.session)) {
    return { ok: false, error: "session must be a non-empty string" };
  }

  const llmCandidate = {
    ...raw,
  };
  delete llmCandidate.id;
  delete llmCandidate.timestamp;
  delete llmCandidate.session;

  const llmValidation = validateLlmOutput(llmCandidate);
  if (!llmValidation.ok) {
    return llmValidation;
  }

  return {
    ok: true,
    entry: {
      ...llmValidation.entry,
      id: raw.id,
      timestamp: raw.timestamp,
      session: raw.session,
    } as LogEntry,
  };
}

export function validateLlmOutput(
  raw: unknown,
):
  | { ok: true; entry: Omit<LogEntry, "id" | "timestamp" | "session"> }
  | { ok: false; error: string } {
  if (!isObject(raw)) {
    return { ok: false, error: "entry must be an object" };
  }

  if (raw.id !== undefined || raw.timestamp !== undefined || raw.session !== undefined) {
    return { ok: false, error: "LLM output must not include id, timestamp, or session" };
  }

  const type = parseType(raw.type);
  if (!type) {
    return { ok: false, error: "type must be one of task, fact, decision, question, handoff" };
  }

  const allowedKeys = new Set([
    "type",
    "content",
    "detail",
    "subject",
    "replaces",
    ...(type === "task" ? ["status"] : []),
  ]);

  if (!hasOnlyAllowedKeys(raw, allowedKeys)) {
    return { ok: false, error: "entry contains unsupported fields" };
  }

  if (type !== "task" && raw.status !== undefined) {
    return { ok: false, error: "only task entries can include status" };
  }

  return buildLlmEntry(raw);
}

export function injectMeta(
  entry: Omit<LogEntry, "id" | "timestamp" | "session">,
  sessionId: string,
): LogEntry {
  return finalizeEntry(entry, {
    sessionId,
  });
}

export function finalizeEntry(
  entry: Omit<LogEntry, "id" | "timestamp" | "session">,
  opts: {
    sessionId: string;
    timestamp?: string;
    id?: string;
  },
): LogEntry {
  if (!isNonEmptyString(opts.sessionId)) {
    throw new Error("sessionId must be a non-empty string");
  }

  const validation = validateLlmOutput(entry);
  if (!validation.ok) {
    throw new Error(`invalid entry payload: ${validation.error}`);
  }

  return {
    ...validation.entry,
    id: opts.id && isNonEmptyString(opts.id) ? opts.id : generateId(),
    timestamp:
      opts.timestamp && isNonEmptyString(opts.timestamp) && isIsoTimestamp(opts.timestamp)
        ? opts.timestamp
        : new Date().toISOString(),
    session: opts.sessionId,
  } as LogEntry;
}

export async function appendEntry(logPath: string, entry: LogEntry): Promise<void> {
  const validation = validateEntry(entry);
  if (!validation.ok) {
    throw new Error(`invalid log entry: ${validation.error}`);
  }

  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(validation.entry)}\n`, "utf8");
}

export async function readLog(logPath: string): Promise<LogEntry[]> {
  let content: string;
  try {
    content = await readFile(logPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const entries: LogEntry[] = [];
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`invalid JSON in ${logPath} at line ${index + 1}`);
    }

    const validated = validateEntry(parsed);
    if (!validated.ok) {
      throw new Error(`invalid log entry in ${logPath} at line ${index + 1}: ${validated.error}`);
    }

    entries.push(validated.entry);
  }

  return entries;
}
