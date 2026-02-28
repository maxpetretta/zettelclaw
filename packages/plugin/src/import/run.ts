import { readFile } from "node:fs/promises";
import { appendEntry, type LogEntry } from "../log/schema";
import {
  readState,
  type ImportedConversationState,
  type ZettelclawState,
  writeState,
} from "../state";
import { ensureSubject } from "../subjects/registry";
import { parseChatGptConversations } from "./adapters/chatgpt";
import { parseClaudeConversations } from "./adapters/claude";
import { parseGrokConversations } from "./adapters/grok";
import { extractImportedConversation } from "./extract";
import { writeImportedSession } from "./sessions";
import type { ImportPlatform, ImportedConversation } from "./types";

export const DEFAULT_IMPORT_MIN_MESSAGES = 4;
export const DEFAULT_IMPORT_JOBS = 3;
export const DEFAULT_IMPORT_MODEL = "anthropic/claude-haiku-4-5";

export interface ReclawImportOptions {
  platform: ImportPlatform;
  filePath: string;
  logPath: string;
  subjectsPath: string;
  statePath: string;
  dryRun?: boolean;
  after?: string;
  before?: string;
  minMessages?: number;
  jobs?: number;
  model?: string;
  force?: boolean;
  transcripts?: boolean;
  verbose?: boolean;
  apiBaseUrl?: string;
  apiToken?: string;
  openClawHome?: string;
  agentId?: string;
}

export interface ReclawImportSummary {
  platform: ImportPlatform;
  parsed: number;
  dedupedInInput: number;
  selected: number;
  skippedByDate: number;
  skippedByMinMessages: number;
  skippedAlreadyImported: number;
  imported: number;
  failed: number;
  entriesWritten: number;
  transcriptsWritten: number;
  dryRun: boolean;
}

interface CandidateConversation {
  key: string;
  conversation: ImportedConversation;
}

interface ImportLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

interface ReclawImportDeps {
  readImportFile: (path: string) => Promise<unknown>;
  parseConversations: (platform: ImportPlatform, raw: unknown) => ImportedConversation[];
  extractConversation: (params: {
    conversation: ImportedConversation;
    sessionId: string;
    subjectsPath: string;
    model: string;
    apiBaseUrl?: string;
    apiToken?: string;
  }) => Promise<LogEntry[]>;
  ensureSubject: (path: string, slug: string) => Promise<void>;
  appendEntry: (logPath: string, entry: LogEntry) => Promise<void>;
  readState: (path: string) => Promise<ZettelclawState>;
  writeState: (path: string, state: ZettelclawState) => Promise<void>;
  writeImportedSession: typeof writeImportedSession;
}

const DEFAULT_LOGGER: ImportLogger = {
  info(message) {
    console.log(message);
  },
  warn(message) {
    console.warn(message);
  },
};

const DEFAULT_DEPS: ReclawImportDeps = {
  async readImportFile(path) {
    const rawText = await readFile(path, "utf8");
    try {
      return JSON.parse(rawText) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to parse import JSON: ${reason}`);
    }
  },
  parseConversations(platform, raw) {
    if (platform === "chatgpt") {
      return parseChatGptConversations(raw);
    }

    if (platform === "claude") {
      return parseClaudeConversations(raw);
    }

    return parseGrokConversations(raw);
  },
  async extractConversation(params) {
    return await extractImportedConversation(
      {
        conversation: params.conversation,
        sessionId: params.sessionId,
        subjectsPath: params.subjectsPath,
        model: params.model,
        apiBaseUrl: params.apiBaseUrl,
        apiToken: params.apiToken,
        ensureSubjects: false,
      },
    );
  },
  ensureSubject,
  appendEntry,
  readState,
  writeState,
  writeImportedSession,
};

function parseBoundary(raw: string | undefined, optionName: "--after" | "--before"): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ${optionName} value: ${raw}`);
  }

  return parsed;
}

function createConversationKey(platform: ImportPlatform, conversationId: string): string {
  return `${platform}:${conversationId}`;
}

function buildSessionId(platform: ImportPlatform, conversationId: string): string {
  return `reclaw:${platform}:${conversationId}`;
}

function countExtractableMessages(conversation: ImportedConversation): number {
  return conversation.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  ).length;
}

function choosePreferredConversation(current: ImportedConversation, incoming: ImportedConversation): ImportedConversation {
  const currentUpdatedAt = Date.parse(current.updatedAt);
  const incomingUpdatedAt = Date.parse(incoming.updatedAt);

  if (Number.isFinite(incomingUpdatedAt) && Number.isFinite(currentUpdatedAt)) {
    if (incomingUpdatedAt > currentUpdatedAt) {
      return incoming;
    }

    if (incomingUpdatedAt < currentUpdatedAt) {
      return current;
    }
  }

  if (countExtractableMessages(incoming) > countExtractableMessages(current)) {
    return incoming;
  }

  return current;
}

function dedupeInputConversations(
  platform: ImportPlatform,
  conversations: ImportedConversation[],
): { conversations: ImportedConversation[]; duplicates: number } {
  const byKey = new Map<string, ImportedConversation>();
  let duplicates = 0;

  for (const conversation of conversations) {
    const key = createConversationKey(platform, conversation.conversationId);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, conversation);
      continue;
    }

    duplicates += 1;
    byKey.set(key, choosePreferredConversation(existing, conversation));
  }

  return {
    conversations: [...byKey.values()],
    duplicates,
  };
}

function createImportedStateRecord(sessionId: string, conversation: ImportedConversation, entries: number): ImportedConversationState {
  return {
    at: new Date().toISOString(),
    updatedAt: conversation.updatedAt,
    sessionId,
    entries,
    title: conversation.title,
  };
}

async function runWithConcurrency<T>(
  items: T[],
  maxJobs: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const limit = Math.max(1, Math.floor(maxJobs));
  const workerCount = Math.min(limit, items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(items[currentIndex] as T, currentIndex);
      }
    }),
  );
}

export async function runReclawImport(
  options: ReclawImportOptions,
  deps: Partial<ReclawImportDeps> = {},
  logger: ImportLogger = DEFAULT_LOGGER,
): Promise<ReclawImportSummary> {
  const runtimeDeps: ReclawImportDeps = {
    ...DEFAULT_DEPS,
    ...deps,
  };

  const minMessages = Math.max(1, Math.floor(options.minMessages ?? DEFAULT_IMPORT_MIN_MESSAGES));
  const jobs = Math.max(1, Math.floor(options.jobs ?? DEFAULT_IMPORT_JOBS));
  const model = options.model?.trim() || DEFAULT_IMPORT_MODEL;
  const transcripts = options.transcripts !== false;
  const dryRun = options.dryRun === true;
  const afterMs = parseBoundary(options.after, "--after");
  const beforeMs = parseBoundary(options.before, "--before");

  const rawImport = await runtimeDeps.readImportFile(options.filePath);
  const parsedRaw = runtimeDeps.parseConversations(options.platform, rawImport);
  const deduped = dedupeInputConversations(options.platform, parsedRaw);
  const state = await runtimeDeps.readState(options.statePath);

  const summary: ReclawImportSummary = {
    platform: options.platform,
    parsed: parsedRaw.length,
    dedupedInInput: deduped.duplicates,
    selected: 0,
    skippedByDate: 0,
    skippedByMinMessages: 0,
    skippedAlreadyImported: 0,
    imported: 0,
    failed: 0,
    entriesWritten: 0,
    transcriptsWritten: 0,
    dryRun,
  };

  const selected: CandidateConversation[] = [];

  for (const conversation of deduped.conversations) {
    const key = createConversationKey(options.platform, conversation.conversationId);
    const updatedAtMs = Date.parse(conversation.updatedAt);

    if (afterMs !== undefined && Number.isFinite(updatedAtMs) && updatedAtMs < afterMs) {
      summary.skippedByDate += 1;
      if (options.verbose) {
        logger.info(`skip (date<after) ${key}`);
      }
      continue;
    }

    if (beforeMs !== undefined && Number.isFinite(updatedAtMs) && updatedAtMs > beforeMs) {
      summary.skippedByDate += 1;
      if (options.verbose) {
        logger.info(`skip (date>before) ${key}`);
      }
      continue;
    }

    if (countExtractableMessages(conversation) < minMessages) {
      summary.skippedByMinMessages += 1;
      if (options.verbose) {
        logger.info(`skip (min-messages) ${key}`);
      }
      continue;
    }

    if (!options.force && state.importedConversations[key]) {
      summary.skippedAlreadyImported += 1;
      if (options.verbose) {
        logger.info(`skip (already-imported) ${key}`);
      }
      continue;
    }

    selected.push({
      key,
      conversation,
    });
  }

  summary.selected = selected.length;
  logger.info(
    `Reclaw import ${options.platform}: parsed=${summary.parsed}, selected=${summary.selected}, dryRun=${dryRun}`,
  );

  if (dryRun || selected.length === 0) {
    return summary;
  }

  let commitQueue: Promise<void> = Promise.resolve();
  const withCommitLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const task = commitQueue.then(fn, fn);
    commitQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return await task;
  };

  let completed = 0;
  await runWithConcurrency(selected, jobs, async (candidate) => {
    const sessionId = buildSessionId(options.platform, candidate.conversation.conversationId);

    try {
      const entries = await runtimeDeps.extractConversation({
        conversation: candidate.conversation,
        sessionId,
        subjectsPath: options.subjectsPath,
        model,
        apiBaseUrl: options.apiBaseUrl,
        apiToken: options.apiToken,
      });

      await withCommitLock(async () => {
        const subjects = new Set(
          entries
            .map((entry) => entry.subject)
            .filter((subject): subject is string => typeof subject === "string" && subject.length > 0),
        );

        for (const subject of subjects) {
          await runtimeDeps.ensureSubject(options.subjectsPath, subject);
        }

        for (const entry of entries) {
          await runtimeDeps.appendEntry(options.logPath, entry);
        }

        if (transcripts) {
          await runtimeDeps.writeImportedSession({
            conversation: candidate.conversation,
            sessionId,
            openClawHome: options.openClawHome,
            agentId: options.agentId,
          });
          summary.transcriptsWritten += 1;
        }

        summary.entriesWritten += entries.length;
        summary.imported += 1;
        state.importedConversations[candidate.key] = createImportedStateRecord(
          sessionId,
          candidate.conversation,
          entries.length,
        );
        await runtimeDeps.writeState(options.statePath, state);
      });

      completed += 1;
      logger.info(
        `[${completed}/${summary.selected}] imported ${candidate.key} (${entries.length} entries)`,
      );
    } catch (error) {
      completed += 1;
      summary.failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(`[${completed}/${summary.selected}] failed ${candidate.key}: ${reason}`);
    }
  });

  return summary;
}
