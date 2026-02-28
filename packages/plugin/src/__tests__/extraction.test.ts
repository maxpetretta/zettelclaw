import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../config";
import { registerExtractionHooks } from "../hooks/extraction";
import { readLog } from "../log/schema";
import { readState } from "../state";
import { readRegistry } from "../subjects/registry";

type HookHandlers = {
  session_end?: (event: { sessionId: string; messageCount: number }, ctx: { agentId?: string; sessionId: string }) => Promise<void>;
  before_reset?: (event: { messages?: unknown[] }, ctx: { sessionId?: string; sessionKey?: string }) => Promise<void>;
  gateway_start?: (event: { port: number }) => Promise<void>;
};

function createMockApi(config: unknown, handlers: HookHandlers): OpenClawPluginApi {
  const api = {
    config,
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    registerHook(hookName: string, handler: (...args: unknown[]) => Promise<void>) {
      (handlers as Record<string, (...args: unknown[]) => Promise<void>>)[hookName] = handler;
    },
  };

  return api as unknown as OpenClawPluginApi;
}

function createPluginConfig(logDir: string): PluginConfig {
  return {
    logDir,
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

describe("extraction hooks", () => {
  let tempDir = "";
  let openclawHome = "";
  let logDir = "";
  let originalOpenClawHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zettelclaw-extraction-"));
    openclawHome = join(tempDir, "openclaw");
    logDir = join(tempDir, "zettelclaw");

    originalOpenClawHome = process.env.OPENCLAW_HOME;
    process.env.OPENCLAW_HOME = openclawHome;
  });

  afterEach(async () => {
    if (originalOpenClawHome === undefined) {
      delete process.env.OPENCLAW_HOME;
    } else {
      process.env.OPENCLAW_HOME = originalOpenClawHome;
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  test("session_end runs extraction pipeline and dedups repeated sessions", async () => {
    const transcriptPath = join(openclawHome, "agents", "agent-1", "sessions", "session-1.jsonl");
    await mkdir(join(openclawHome, "agents", "agent-1", "sessions"), { recursive: true });
    await writeFile(
      transcriptPath,
      [
        '{"type":"session","id":"session-1","timestamp":"2026-02-20T00:00:00.000Z"}',
        '{"type":"message","timestamp":"2026-02-20T00:01:00.000Z","message":{"role":"user","content":"Decide retry policy"}}',
        '{"type":"message","timestamp":"2026-02-20T00:02:00.000Z","message":{"role":"assistant","content":"Use queue + backoff"}}',
      ].join("\n"),
      "utf8",
    );

    let llmCalls = 0;
    const handlers: HookHandlers = {};
    const api = createMockApi({}, handlers);

    registerExtractionHooks(api, createPluginConfig(logDir), {
      extractFromTranscript: async () => {
        llmCalls += 1;
        return [
          '{"type":"decision","content":"Queue retries for webhooks","detail":"Avoid sync retry storms","subject":"auth-migration"}',
          "not-json",
        ].join("\n");
      },
    });

    await handlers.session_end?.(
      { sessionId: "session-1", messageCount: 5 },
      { agentId: "agent-1", sessionId: "session-1" },
    );

    await handlers.session_end?.(
      { sessionId: "session-1", messageCount: 5 },
      { agentId: "agent-1", sessionId: "session-1" },
    );

    const entries = await readLog(join(logDir, "log.jsonl"));
    const state = await readState(join(logDir, "state.json"));
    const registry = await readRegistry(join(logDir, "subjects.json"));

    expect(llmCalls).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.session).toBe("session-1");
    expect(registry["auth-migration"]?.display).toBe("Auth Migration");
    expect(state.extractedSessions["session-1"]?.entries).toBe(1);
  });

  test("before_reset skips scoped session types", async () => {
    let llmCalls = 0;
    const handlers: HookHandlers = {};
    const api = createMockApi({}, handlers);

    registerExtractionHooks(api, createPluginConfig(logDir), {
      extractFromTranscript: async () => {
        llmCalls += 1;
        return '{"type":"fact","content":"should not run"}';
      },
    });

    await handlers.before_reset?.(
      {
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      { sessionId: "session-2", sessionKey: "cron:daily" },
    );

    const state = await readState(join(logDir, "state.json"));
    expect(llmCalls).toBe(0);
    expect(state.extractedSessions["session-2"]).toBeUndefined();
  });

  test("failed extraction is marked once and not retried after limit", async () => {
    let llmCalls = 0;
    const handlers: HookHandlers = {};
    const api = createMockApi({}, handlers);

    registerExtractionHooks(api, createPluginConfig(logDir), {
      extractFromTranscript: async () => {
        llmCalls += 1;
        throw new Error("LLM timeout");
      },
    });

    const resetEvent = {
      messages: [
        {
          role: "user",
          content: "Need memory extraction",
        },
      ],
    };

    // First attempt: fails, retries=1, shouldRetry=true
    await handlers.before_reset?.(resetEvent, { sessionId: "session-fail", sessionKey: "agent:main" });
    // Second attempt: retries (shouldRetry still true), fails again, retries=2, shouldRetry=false
    await handlers.before_reset?.(resetEvent, { sessionId: "session-fail", sessionKey: "agent:main" });
    // Third attempt: permanently failed, skipped
    await handlers.before_reset?.(resetEvent, { sessionId: "session-fail", sessionKey: "agent:main" });

    const state = await readState(join(logDir, "state.json"));

    expect(llmCalls).toBe(2);
    expect(state.failedSessions["session-fail"]?.retries).toBe(2);
    expect(state.extractedSessions["session-fail"]).toBeUndefined();
  });
});
