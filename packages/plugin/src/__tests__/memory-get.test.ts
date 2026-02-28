import { describe, expect, test } from "bun:test";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../config";
import { createWrappedMemoryGetTool } from "../tools/memory-get";
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
    id: "abc123def456",
    timestamp: "2026-02-20T00:00:00.000Z",
    type: "decision",
    content: "Queue retries",
    detail: "Avoid sync retries",
    session: "session-1",
    ...partial,
  };
}

describe("memory-get", () => {
  test("12-char id path returns matching log entry JSON", async () => {
    const api = {
      runtime: {
        tools: {
          createMemoryGetTool: () => null,
        },
      },
    } as unknown as OpenClawPluginApi;

    const tool = createWrappedMemoryGetTool(api, createContext(), createConfig(), {
      queryLog: async () => [createEntry()],
      findTranscriptFile: async () => null,
      readTranscript: async () => [],
    });

    const result = await tool.execute("call-1", { path: "abc123def456" });
    const text = readResultText(result);

    expect(text).toContain('"id": "abc123def456"');
    expect(text).toContain('"type": "decision"');
  });

  test("session: path returns formatted transcript text", async () => {
    const api = {
      runtime: {
        tools: {
          createMemoryGetTool: () => null,
        },
      },
    } as unknown as OpenClawPluginApi;

    const tool = createWrappedMemoryGetTool(api, createContext(), createConfig(), {
      queryLog: async () => [],
      findTranscriptFile: async () => "/tmp/session-2.jsonl",
      readTranscript: async () => [
        {
          role: "user",
          content: "Need a handoff",
          timestamp: "2026-02-20T00:01:00.000Z",
        },
      ],
    });

    const result = await tool.execute("call-2", { path: "session:session-2" });
    const text = readResultText(result);

    expect(text).toContain("2026-02-20T00:01:00.000Z user: Need a handoff");
  });

  test("regular file path is delegated to builtin memory_get", async () => {
    let delegated = false;

    const api = {
      runtime: {
        tools: {
          createMemoryGetTool: () => ({
            name: "memory_get",
            description: "builtin",
            parameters: { type: "object", properties: { path: { type: "string" } } },
            async execute(_toolCallId: string, params: Record<string, unknown>) {
              delegated = true;
              return { content: [{ type: "text", text: `builtin:${String(params.path)}` }] };
            },
          }),
        },
      },
    } as unknown as OpenClawPluginApi;

    const tool = createWrappedMemoryGetTool(api, createContext(), createConfig(), {
      queryLog: async () => [],
      findTranscriptFile: async () => null,
      readTranscript: async () => [],
    });

    const result = await tool.execute("call-3", { path: "MEMORY.md" });
    const text = readResultText(result);

    expect(delegated).toBe(true);
    expect(text).toBe("builtin:MEMORY.md");
  });

  test("returns not found when entry id does not exist", async () => {
    const api = {
      runtime: {
        tools: {
          createMemoryGetTool: () => null,
        },
      },
    } as unknown as OpenClawPluginApi;

    const tool = createWrappedMemoryGetTool(api, createContext(), createConfig(), {
      queryLog: async () => [],
      findTranscriptFile: async () => null,
      readTranscript: async () => [],
    });

    const result = await tool.execute("call-4", { path: "zzz999yyy888" });
    const text = readResultText(result);

    expect(text).toBe("Entry not found: zzz999yyy888");
  });
});
