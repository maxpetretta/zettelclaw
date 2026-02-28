import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ImportedConversation } from "./types";

const OPENCLAW_SESSION_VERSION = 3;

interface SessionStoreEntry {
  sessionId: string;
  updatedAt: number;
  sessionFile: string;
  label: string;
  origin: {
    label: string;
    provider: string;
    surface: string;
  };
  archived: true;
}

export interface WriteImportedSessionOptions {
  conversation: ImportedConversation;
  sessionId: string;
  openClawHome?: string;
  agentId?: string;
}

export interface WriteImportedSessionResult {
  sessionFile: string;
  sessionsPath: string;
  sessionKey: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveOpenClawHome(openClawHome?: string): string {
  if (openClawHome && openClawHome.trim()) {
    return openClawHome.trim();
  }

  const envOverride = process.env.OPENCLAW_HOME?.trim();
  if (envOverride) {
    return envOverride;
  }

  return join(homedir(), ".openclaw");
}

function resolveUpdatedAtMs(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return Date.now();
}

function buildTranscriptJsonl(conversation: ImportedConversation, sessionId: string): string {
  const lines: string[] = [];

  lines.push(
    JSON.stringify({
      type: "session",
      version: OPENCLAW_SESSION_VERSION,
      id: sessionId,
      timestamp: conversation.createdAt,
      cwd: process.cwd(),
    }),
  );

  let parentId: string | null = null;

  const transcriptMessages = conversation.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );

  for (const [index, message] of transcriptMessages.entries()) {
    const id = `reclaw-${String(index + 1)}`;
    lines.push(
      JSON.stringify({
        type: "message",
        id,
        parentId,
        timestamp: message.createdAt,
        message: {
          role: message.role,
          content: [{ type: "text", text: message.content }],
        },
      }),
    );
    parentId = id;
  }

  return `${lines.join("\n")}\n`;
}

async function readSessionStore(path: string): Promise<Record<string, unknown>> {
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return {};
    }

    throw error;
  }

  const parsed = JSON.parse(raw) as unknown;
  return isObject(parsed) ? parsed : {};
}

export async function writeImportedSession(
  options: WriteImportedSessionOptions,
): Promise<WriteImportedSessionResult> {
  const openClawHome = resolveOpenClawHome(options.openClawHome);
  const agentId = options.agentId?.trim() || "main";
  const sessionsDir = join(openClawHome, "agents", agentId, "sessions");
  const sessionFile = join(sessionsDir, `${options.sessionId}.jsonl`);
  const sessionsPath = join(sessionsDir, "sessions.json");
  const sessionKey = `agent:${agentId}:${options.sessionId}`;

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(sessionFile, buildTranscriptJsonl(options.conversation, options.sessionId), "utf8");

  const store = await readSessionStore(sessionsPath);
  const existing = isObject(store[sessionKey]) ? (store[sessionKey] as Record<string, unknown>) : {};

  const entry: SessionStoreEntry = {
    sessionId: options.sessionId,
    updatedAt: resolveUpdatedAtMs(options.conversation.updatedAt),
    sessionFile,
    label: options.conversation.title,
    origin: {
      label: options.conversation.title,
      provider: options.conversation.platform,
      surface: "reclaw-import",
    },
    archived: true,
  };

  store[sessionKey] = {
    ...existing,
    ...entry,
  };

  await writeFile(sessionsPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  return {
    sessionFile,
    sessionsPath,
    sessionKey,
  };
}
