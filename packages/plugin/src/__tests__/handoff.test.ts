import { beforeEach, describe, expect, test } from "bun:test";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../config";
import {
  formatHandoffContext,
  registerHandoffHook,
  resetHandoffCacheForTests,
} from "../hooks/handoff";
import type { LogEntry } from "../log/schema";

type HandoffHook = (event: unknown, ctx: { sessionId?: string }) => Promise<{ prependContext: string } | undefined>;

function createConfig(): PluginConfig {
  return {
    logDir: "/tmp/zettelclaw",
    extraction: {
      model: "anthropic/claude-sonnet-4-6",
      skipSessionTypes: ["cron:", "sub:", "hook:"],
    },
    briefing: {
      model: "anthropic/claude-sonnet-4-6",
      activeWindow: 14,
      decisionWindow: 7,
      staleThreshold: 30,
      maxLines: 80,
    },
    cron: {
      schedule: "0 3 * * *",
      timezone: "UTC",
    },
  };
}

function createHandoffEntry(partial: Partial<LogEntry> = {}): LogEntry {
  return {
    id: "handoffabc12_",
    timestamp: "2026-02-20T15:30:00.000Z",
    type: "handoff",
    content: "Auth migration in progress",
    detail: "Backfill remains",
    session: "session-1",
    ...partial,
  };
}

function createMockApi(holder: { hook?: HandoffHook }): OpenClawPluginApi {
  const api = {
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    registerHook(name: string, handler: HandoffHook) {
      if (name === "before_prompt_build") {
        holder.hook = handler;
      }
    },
  };

  return api as unknown as OpenClawPluginApi;
}

describe("handoff hook", () => {
  beforeEach(() => {
    resetHandoffCacheForTests();
  });

  test("returns prependContext when handoff exists", async () => {
    const holder: { hook?: HandoffHook } = {};
    const api = createMockApi(holder);

    registerHandoffHook(api, createConfig(), {
      getLogMtime: async () => 10,
      getLastHandoff: async () => createHandoffEntry(),
    });

    const result = await holder.hook?.({}, { sessionId: "session-2" });

    expect(result?.prependContext).toContain("## Last Session Handoff");
    expect(result?.prependContext).toContain("Auth migration in progress");
    expect(result?.prependContext).toContain("Detail: Backfill remains");
  });

  test("returns undefined when no handoff exists", async () => {
    const holder: { hook?: HandoffHook } = {};
    const api = createMockApi(holder);

    registerHandoffHook(api, createConfig(), {
      getLogMtime: async () => 10,
      getLastHandoff: async () => undefined,
    });

    const result = await holder.hook?.({}, { sessionId: "session-3" });
    expect(result).toBeUndefined();
  });

  test("caches handoff and re-reads only on session change or mtime update", async () => {
    const holder: { hook?: HandoffHook } = {};
    const api = createMockApi(holder);

    let getLastHandoffCalls = 0;
    const mtimes = [10, 10, 10, 20];

    registerHandoffHook(api, createConfig(), {
      getLogMtime: async () => mtimes.shift() ?? 20,
      getLastHandoff: async () => {
        getLastHandoffCalls += 1;
        return createHandoffEntry();
      },
    });

    await holder.hook?.({}, { sessionId: "session-a" });
    await holder.hook?.({}, { sessionId: "session-a" });
    await holder.hook?.({}, { sessionId: "session-b" });
    await holder.hook?.({}, { sessionId: "session-b" });

    expect(getLastHandoffCalls).toBe(3);
  });

  test("formats content and detail correctly", () => {
    const context = formatHandoffContext(createHandoffEntry());

    expect(context).toContain("Session: session-1 (2026-02-20T15:30:00.000Z)");
    expect(context).toContain("Auth migration in progress");
    expect(context).toContain("Detail: Backfill remains");
  });
});
