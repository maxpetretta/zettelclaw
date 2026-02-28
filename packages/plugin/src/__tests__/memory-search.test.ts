import { describe, expect, test } from "bun:test";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../config";
import { createWrappedMemorySearchTool } from "../tools/memory-search";
import type { LogEntry } from "../log/schema";

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

function createContext(): OpenClawPluginToolContext {
  return {
    config: {} as never,
    sessionKey: "agent:agent-1:main",
    agentId: "agent-1",
  };
}

function readResultText(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "";
  }

  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      return typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
    })
    .join("\n");
}

function createEntry(partial: Partial<LogEntry> = {}): LogEntry {
  return {
    id: "entry00000001",
    timestamp: "2026-02-20T00:00:00.000Z",
    type: "fact",
    content: "Queue retries for webhooks",
    session: "session-1",
    ...partial,
  };
}

describe("memory-search", () => {
  test("structured filters return log entries without calling builtin tool", async () => {
    let builtinCalls = 0;

    const api = {
      runtime: {
        tools: {
          createMemorySearchTool: () => ({
            name: "memory_search",
            description: "builtin",
            parameters: { type: "object", properties: { query: { type: "string" } } },
            async execute() {
              builtinCalls += 1;
              return { content: [{ type: "text", text: "builtin result" }] };
            },
          }),
        },
      },
    } as unknown as OpenClawPluginApi;

    const tool = createWrappedMemorySearchTool(api, createContext(), createConfig(), {
      queryLog: async () => [createEntry({ type: "task", status: "open", subject: "auth-migration" })],
      searchLog: async () => [],
    });

    const result = await tool.execute("call-1", { type: "task", status: "open" });
    const text = readResultText(result);

    expect(builtinCalls).toBe(0);
    expect(text).toContain("[task] auth-migration");
    expect(text).toContain("Queue retries for webhooks");
  });

  test("returns no results gracefully when structured log query is empty", async () => {
    const api = {
      runtime: {
        tools: {
          createMemorySearchTool: () => null,
        },
      },
    } as unknown as OpenClawPluginApi;

    const tool = createWrappedMemorySearchTool(api, createContext(), createConfig(), {
      queryLog: async () => [],
      searchLog: async () => [],
    });

    const result = await tool.execute("call-2", { type: "decision" });
    const text = readResultText(result);

    expect(text).toContain("No results.");
  });

  test("falls back to log-only keyword search when builtin tool is unavailable", async () => {
    const api = {
      runtime: {
        tools: {
          createMemorySearchTool: () => null,
        },
      },
    } as unknown as OpenClawPluginApi;

    const tool = createWrappedMemorySearchTool(api, createContext(), createConfig(), {
      queryLog: async () => [],
      searchLog: async () => [createEntry({ type: "decision", subject: "auth-migration" })],
    });

    const result = await tool.execute("call-3", { query: "webhook retry" });
    const text = readResultText(result);

    expect(text).toContain("[decision] auth-migration");
    expect(text).toContain("Queue retries for webhooks");
  });
});
