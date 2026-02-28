import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginConfig } from "../config";
import {
  BRIEFING_BEGIN_MARKER,
  BRIEFING_END_MARKER,
  generateBriefing,
} from "../briefing/generate";

function createConfig(logDir: string): PluginConfig {
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

const LOG_LINE =
  '{"id":"abc123def456","timestamp":"2026-02-20T00:00:00.000Z","type":"fact","content":"Queue retries enabled","session":"session-1"}\n';

describe("briefing generation", () => {
  let tempDir = "";
  let logPath = "";
  let memoryPath = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zettelclaw-briefing-"));
    logPath = join(tempDir, "log.jsonl");
    memoryPath = join(tempDir, "MEMORY.md");

    await writeFile(logPath, LOG_LINE, "utf8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("replaces content between markers", async () => {
    await writeFile(
      memoryPath,
      [
        "## Goals",
        "- Ship V3",
        "",
        BRIEFING_BEGIN_MARKER,
        "old generated content",
        BRIEFING_END_MARKER,
        "",
        "## Notes",
        "Keep this.",
      ].join("\n"),
      "utf8",
    );

    await generateBriefing(
      {
        logPath,
        memoryMdPath: memoryPath,
        config: createConfig(tempDir),
      },
      {
        callBriefingModel: async () => "## Active\n- auth-migration — Queue retries enabled",
      },
    );

    const content = await readFile(memoryPath, "utf8");

    expect(content).toContain("## Goals");
    expect(content).toContain("## Notes");
    expect(content).toContain("## Active");
    expect(content).toContain("auth-migration");
    expect(content).not.toContain("old generated content");
  });

  test("creates markers if missing", async () => {
    await writeFile(memoryPath, "## Goals\n- Ship V3\n", "utf8");

    await generateBriefing(
      {
        logPath,
        memoryMdPath: memoryPath,
        config: createConfig(tempDir),
      },
      {
        callBriefingModel: async () => "## Pending\n- Follow up with retries",
      },
    );

    const content = await readFile(memoryPath, "utf8");

    expect(content).toContain(BRIEFING_BEGIN_MARKER);
    expect(content).toContain(BRIEFING_END_MARKER);
    expect(content).toContain("## Pending");
  });

  test("preserves content outside generated markers", async () => {
    await writeFile(
      memoryPath,
      [
        "Header content",
        "",
        BRIEFING_BEGIN_MARKER,
        "old",
        BRIEFING_END_MARKER,
        "",
        "Footer content",
      ].join("\n"),
      "utf8",
    );

    await generateBriefing(
      {
        logPath,
        memoryMdPath: memoryPath,
        config: createConfig(tempDir),
      },
      {
        callBriefingModel: async () => "## Recent Decisions\n- 2026-02-20: Queue retries enabled",
      },
    );

    const content = await readFile(memoryPath, "utf8");

    expect(content).toContain("Header content");
    expect(content).toContain("Footer content");
    expect(content).toContain("## Recent Decisions");
  });
});
