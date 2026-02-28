import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../config";
import { appendEntry, finalizeEntry, validateLlmOutput } from "../log/schema";
import { extractFromTranscript } from "../lib/llm";
import {
  findTranscriptFile,
  formatTranscript,
  readTranscript,
  type TranscriptMessage,
} from "../lib/transcript";
import {
  isExtracted,
  markExtracted,
  markFailed,
  pruneState,
  readState,
  shouldRetry,
} from "../state";
import { ensureSubject, readRegistry } from "../subjects/registry";

interface ZettelclawPaths {
  logPath: string;
  subjectsPath: string;
  statePath: string;
}

interface SessionCandidate {
  agentId: string;
  sessionId: string;
}

export interface ExtractionHookDeps {
  extractFromTranscript: typeof extractFromTranscript;
  findTranscriptFile: typeof findTranscriptFile;
  readTranscript: typeof readTranscript;
  formatTranscript: typeof formatTranscript;
  listSessionCandidates: typeof listSessionCandidates;
}

const DEFAULT_DEPS: ExtractionHookDeps = {
  extractFromTranscript,
  findTranscriptFile,
  readTranscript,
  formatTranscript,
  listSessionCandidates,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function resolveOpenClawHome(): string {
  const override = process.env.OPENCLAW_HOME?.trim();
  if (override) {
    return override;
  }

  return join(homedir(), ".openclaw");
}

function parseSessionIdFromFileName(fileName: string): string | null {
  if (!fileName.endsWith(".jsonl") && !fileName.includes(".jsonl.reset.")) {
    return null;
  }

  const jsonlResetIndex = fileName.indexOf(".jsonl.reset.");
  if (jsonlResetIndex > 0) {
    return fileName.slice(0, jsonlResetIndex);
  }

  const resetIndex = fileName.indexOf(".reset.");
  if (resetIndex > 0 && fileName.endsWith(".jsonl")) {
    return fileName.slice(0, resetIndex);
  }

  if (fileName.endsWith(".jsonl") && !fileName.includes(".reset.")) {
    return fileName.slice(0, -6);
  }

  return null;
}

const DEFAULT_SWEEP_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

export async function listSessionCandidates(
  openClawHome = resolveOpenClawHome(),
  maxAgeMs = DEFAULT_SWEEP_MAX_AGE_MS,
): Promise<SessionCandidate[]> {
  const agentsDir = join(openClawHome, "agents");
  const cutoff = Date.now() - maxAgeMs;

  let agentDirs: string[];
  try {
    agentDirs = await readdir(agentsDir);
  } catch {
    return [];
  }

  const discovered = new Set<string>();

  for (const agentId of agentDirs) {
    const sessionsDir = join(agentsDir, agentId, "sessions");

    let files: string[];
    try {
      files = await readdir(sessionsDir);
    } catch {
      continue;
    }

    for (const fileName of files) {
      const sessionId = parseSessionIdFromFileName(fileName);
      if (!sessionId) {
        continue;
      }

      // Skip old files — only sweep recent sessions
      try {
        const fileStat = await stat(join(sessionsDir, fileName));
        if (fileStat.mtimeMs < cutoff) continue;
      } catch {
        continue;
      }

      discovered.add(`${agentId}\u0000${sessionId}`);
    }
  }

  const candidates: SessionCandidate[] = [];
  for (const value of discovered) {
    const [agentId, sessionId] = value.split("\u0000");
    if (!agentId || !sessionId) {
      continue;
    }
    candidates.push({ agentId, sessionId });
  }

  return candidates.sort((left, right) => {
      if (left.agentId !== right.agentId) {
        return left.agentId.localeCompare(right.agentId);
      }

      return left.sessionId.localeCompare(right.sessionId);
    });
}

function resolvePaths(config: PluginConfig): ZettelclawPaths {
  return {
    logPath: join(config.logDir, "log.jsonl"),
    subjectsPath: join(config.logDir, "subjects.json"),
    statePath: join(config.logDir, "state.json"),
  };
}

function shouldSkipSessionKey(sessionKey: string | undefined, skipPrefixes: string[]): boolean {
  if (!sessionKey) {
    return false;
  }

  return skipPrefixes.some((prefix) => sessionKey.startsWith(prefix));
}

function readGatewayPort(config: unknown): number | null {
  if (!isObject(config)) {
    return null;
  }

  const gateway = config.gateway;
  if (!isObject(gateway)) {
    return null;
  }

  return typeof gateway.port === "number" && Number.isFinite(gateway.port) ? gateway.port : null;
}

function readGatewayToken(config: unknown): string | undefined {
  if (!isObject(config)) {
    return undefined;
  }

  const gateway = config.gateway;
  if (!isObject(gateway)) {
    return undefined;
  }

  const auth = gateway.auth;
  if (!isObject(auth)) {
    return undefined;
  }

  return typeof auth.token === "string" && auth.token.trim().length > 0 ? auth.token : undefined;
}

function resolveApiBaseUrl(config: unknown, portOverride?: number): string {
  const port = portOverride ?? readGatewayPort(config) ?? 18789;
  return `http://127.0.0.1:${port}`;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.replaceAll(/\s+/gu, " ").trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    if ((record.type === "text" || record.type === "input_text") && typeof record.text === "string") {
      const normalized = record.text.replaceAll(/\s+/gu, " ").trim();
      if (normalized) {
        parts.push(normalized);
      }
      continue;
    }

    if (typeof record.input_text === "string") {
      const normalized = record.input_text.replaceAll(/\s+/gu, " ").trim();
      if (normalized) {
        parts.push(normalized);
      }
    }
  }

  return parts.join("\n");
}

function extractBeforeResetMessages(rawMessages: unknown[] | undefined): TranscriptMessage[] {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  const extracted: TranscriptMessage[] = [];

  for (const rawMessage of rawMessages) {
    if (!isObject(rawMessage)) {
      continue;
    }

    const topLevelRole = rawMessage.role;
    const nestedMessage = isObject(rawMessage.message) ? rawMessage.message : null;

    const role =
      topLevelRole === "user" || topLevelRole === "assistant"
        ? topLevelRole
        : nestedMessage?.role === "user" || nestedMessage?.role === "assistant"
          ? nestedMessage.role
          : null;

    if (!role) {
      continue;
    }

    const contentValue = nestedMessage?.content ?? rawMessage.content ?? rawMessage.body;
    const content = extractTextContent(contentValue);
    if (!content) {
      continue;
    }

    const timestampValue =
      typeof rawMessage.timestamp === "string"
        ? rawMessage.timestamp
        : typeof nestedMessage?.timestamp === "string"
          ? nestedMessage.timestamp
          : new Date().toISOString();

    extracted.push({
      role,
      content,
      timestamp: timestampValue,
    });
  }

  return extracted;
}

async function runExtractionPipeline(params: {
  sessionId: string;
  messages: TranscriptMessage[];
  paths: ZettelclawPaths;
  config: PluginConfig;
  deps: ExtractionHookDeps;
  logger: OpenClawPluginApi["logger"];
  apiBaseUrl: string;
  apiToken?: string;
}): Promise<void> {
  const state = await readState(params.paths.statePath);

  if (isExtracted(state, params.sessionId)) {
    return;
  }

  if (state.failedSessions[params.sessionId] && !shouldRetry(state, params.sessionId)) {
    return;
  }

  const transcript = params.deps.formatTranscript(params.messages);
  if (!transcript.trim()) {
    await markExtracted(params.paths.statePath, params.sessionId, 0);
    await pruneState(params.paths.statePath);
    return;
  }

  try {
    const subjects = await readRegistry(params.paths.subjectsPath);
    const rawOutput = await params.deps.extractFromTranscript({
      transcript,
      subjects,
      model: params.config.extraction.model,
      apiBaseUrl: params.apiBaseUrl,
      apiToken: params.apiToken,
    });

    let appendedCount = 0;
    const lines = rawOutput.split("\n");

    for (const line of lines) {
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

      const validation = validateLlmOutput(parsed);
      if (!validation.ok) {
        continue;
      }

      const entry = finalizeEntry(validation.entry, { sessionId: params.sessionId });
      if (entry.subject) {
        await ensureSubject(params.paths.subjectsPath, entry.subject);
      }

      await appendEntry(params.paths.logPath, entry);
      appendedCount += 1;
    }

    await markExtracted(params.paths.statePath, params.sessionId, appendedCount);
    await pruneState(params.paths.statePath);
  } catch (error) {
    const message = normalizeError(error);
    params.logger.warn(`zettelclaw extraction failed for ${params.sessionId}: ${message}`);
    await markFailed(params.paths.statePath, params.sessionId, message);
    await pruneState(params.paths.statePath);
  }
}

export function registerExtractionHooks(
  api: OpenClawPluginApi,
  config: PluginConfig,
  deps: Partial<ExtractionHookDeps> = {},
): void {
  const paths = resolvePaths(config);
  const runtimeDeps: ExtractionHookDeps = {
    ...DEFAULT_DEPS,
    ...deps,
  };

  const apiToken = readGatewayToken(api.config);

  api.registerHook("session_end", async (event, ctx) => {
    if (event.messageCount < 4) {
      return;
    }

    if (!ctx.agentId) {
      api.logger.warn(`zettelclaw extraction skipped ${event.sessionId}: missing agentId`);
      return;
    }

    const transcriptFile = await runtimeDeps.findTranscriptFile(ctx.agentId, event.sessionId);
    if (!transcriptFile) {
      await markFailed(paths.statePath, event.sessionId, "transcript file not found");
      return;
    }

    let messages: TranscriptMessage[];
    try {
      messages = await runtimeDeps.readTranscript(transcriptFile);
    } catch (error) {
      await markFailed(paths.statePath, event.sessionId, normalizeError(error));
      return;
    }

    await runExtractionPipeline({
      sessionId: event.sessionId,
      messages,
      paths,
      config,
      deps: runtimeDeps,
      logger: api.logger,
      apiBaseUrl: resolveApiBaseUrl(api.config),
      apiToken,
    });
  });

  api.registerHook("before_reset", async (event, ctx) => {
    if (!ctx.sessionId) {
      return;
    }

    if (shouldSkipSessionKey(ctx.sessionKey, config.extraction.skipSessionTypes)) {
      return;
    }

    const messages = extractBeforeResetMessages(event.messages);

    await runExtractionPipeline({
      sessionId: ctx.sessionId,
      messages,
      paths,
      config,
      deps: runtimeDeps,
      logger: api.logger,
      apiBaseUrl: resolveApiBaseUrl(api.config),
      apiToken,
    });
  });

  api.registerHook("gateway_start", async (event) => {
    const candidates = await runtimeDeps.listSessionCandidates();

    for (const candidate of candidates) {
      const transcriptFile = await runtimeDeps.findTranscriptFile(candidate.agentId, candidate.sessionId);
      if (!transcriptFile) {
        continue;
      }

      let messages: TranscriptMessage[];
      try {
        messages = await runtimeDeps.readTranscript(transcriptFile);
      } catch (error) {
        await markFailed(paths.statePath, candidate.sessionId, normalizeError(error));
        continue;
      }

      if (messages.length < 4) {
        continue;
      }

      await runExtractionPipeline({
        sessionId: candidate.sessionId,
        messages,
        paths,
        config,
        deps: runtimeDeps,
        logger: api.logger,
        apiBaseUrl: resolveApiBaseUrl(api.config, event.port),
        apiToken,
      });
    }
  });
}
