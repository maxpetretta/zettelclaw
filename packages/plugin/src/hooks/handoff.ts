import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../config";
import { getLastHandoff } from "../log/query";
import type { LogEntry } from "../log/schema";

interface HandoffCache {
  entry: LogEntry | null;
  logMtime: number;
  sessionId: string | null;
  initialized: boolean;
}

interface HandoffHookDeps {
  getLastHandoff: typeof getLastHandoff;
  getLogMtime: (path: string) => Promise<number>;
}

const cache: HandoffCache = {
  entry: null,
  logMtime: 0,
  sessionId: null,
  initialized: false,
};

async function readLogMtime(path: string): Promise<number> {
  try {
    const metadata = await stat(path);
    return metadata.mtimeMs;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return 0;
    }

    throw error;
  }
}

const DEFAULT_DEPS: HandoffHookDeps = {
  getLastHandoff,
  getLogMtime: readLogMtime,
};

export function formatHandoffContext(entry: LogEntry): string {
  const lines = [
    "## Last Session Handoff",
    `Session: ${entry.session} (${entry.timestamp})`,
    entry.content,
  ];

  if (entry.detail) {
    lines.push(`Detail: ${entry.detail}`);
  }

  return lines.join("\n");
}

export function registerHandoffHook(
  api: OpenClawPluginApi,
  config: PluginConfig,
  deps: Partial<HandoffHookDeps> = {},
): void {
  const resolvedDeps: HandoffHookDeps = {
    ...DEFAULT_DEPS,
    ...deps,
  };

  const logPath = join(config.logDir, "log.jsonl");

  api.registerHook("before_prompt_build", async (_event, ctx) => {
    const sessionId = ctx.sessionId ?? null;

    let logMtime: number;
    try {
      logMtime = await resolvedDeps.getLogMtime(logPath);
    } catch (error) {
      api.logger.warn(`zettelclaw handoff hook: unable to read log mtime (${String(error)})`);
      return undefined;
    }

    const shouldRefresh =
      !cache.initialized ||
      cache.sessionId !== sessionId ||
      logMtime > cache.logMtime;

    if (shouldRefresh) {
      try {
        const latest = await resolvedDeps.getLastHandoff(logPath);
        cache.entry = latest ?? null;
        cache.logMtime = logMtime;
        cache.sessionId = sessionId;
        cache.initialized = true;
      } catch (error) {
        api.logger.warn(`zettelclaw handoff hook: unable to load handoff (${String(error)})`);
        return undefined;
      }
    }

    if (!cache.entry) {
      return undefined;
    }

    return {
      prependContext: formatHandoffContext(cache.entry),
    };
  });
}

export function resetHandoffCacheForTests(): void {
  cache.entry = null;
  cache.logMtime = 0;
  cache.sessionId = null;
  cache.initialized = false;
}
