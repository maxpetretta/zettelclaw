import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginConfig } from "../config";
import { BRIEFING_BEGIN_MARKER, BRIEFING_END_MARKER, runInit, runUninstall } from "../cli/commands";

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

describe("cli init helpers", () => {
  let tempDir = "";
  let openClawHome = "";
  let workspaceDir = "";
  let logDir = "";
  let originalOpenClawHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zettelclaw-cli-"));
    openClawHome = join(tempDir, "openclaw");
    workspaceDir = join(tempDir, "workspace");
    logDir = join(tempDir, "zettelclaw-store");

    await mkdir(openClawHome, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    originalOpenClawHome = process.env.OPENCLAW_HOME;
    process.env.OPENCLAW_HOME = openClawHome;
  });

  afterEach(async () => {
    if (originalOpenClawHome === undefined) {
      delete process.env.OPENCLAW_HOME;
    } else {
      process.env.OPENCLAW_HOME = originalOpenClawHome;
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  test("runInit creates log files, updates config, and adds MEMORY.md markers", async () => {
    const memoryPath = join(workspaceDir, "MEMORY.md");
    await writeFile(memoryPath, "## Goals\n- Keep tests green\n", "utf8");

    await runInit(createConfig(logDir), workspaceDir);

    const logExists = await Bun.file(join(logDir, "log.jsonl")).exists();
    const subjectsText = await readFile(join(logDir, "subjects.json"), "utf8");
    const stateText = await readFile(join(logDir, "state.json"), "utf8");
    const openClawConfig = JSON.parse(await readFile(join(openClawHome, "openclaw.json"), "utf8")) as Record<string, unknown>;
    const memoryContent = await readFile(memoryPath, "utf8");

    expect(logExists).toBe(true);
    expect(subjectsText.trim()).toBe("{}");
    expect(stateText).toContain("extractedSessions");
    expect((openClawConfig.plugins as { slots?: { memory?: string } }).slots?.memory).toBe("zettelclaw");
    expect(
      (openClawConfig.agents as { defaults?: { compaction?: { memoryFlush?: unknown } } }).defaults?.compaction
        ?.memoryFlush,
    ).toBeNull();
    expect(memoryContent).toContain(BRIEFING_BEGIN_MARKER);
    expect(memoryContent).toContain(BRIEFING_END_MARKER);
  });

  test("runUninstall reverses init config and removes generated briefing block without deleting log data", async () => {
    const memoryPath = join(workspaceDir, "MEMORY.md");
    await writeFile(memoryPath, "## Goals\n- Keep tests green\n", "utf8");

    await runInit(createConfig(logDir), workspaceDir);

    await writeFile(
      memoryPath,
      [
        "## Goals",
        "- Keep tests green",
        "",
        BRIEFING_BEGIN_MARKER,
        "## Active",
        "- auth-migration — Queue retries enabled",
        BRIEFING_END_MARKER,
        "",
        "## Notes",
        "Still here",
      ].join("\n"),
      "utf8",
    );

    await runUninstall(createConfig(logDir), workspaceDir);

    const openClawConfig = JSON.parse(await readFile(join(openClawHome, "openclaw.json"), "utf8")) as {
      plugins?: { slots?: Record<string, unknown> };
      agents?: { defaults?: { compaction?: Record<string, unknown> } };
    };
    const memoryContent = await readFile(memoryPath, "utf8");
    const logExists = await Bun.file(join(logDir, "log.jsonl")).exists();
    const subjectsExists = await Bun.file(join(logDir, "subjects.json")).exists();
    const stateExists = await Bun.file(join(logDir, "state.json")).exists();

    expect(openClawConfig.plugins?.slots?.memory).toBeUndefined();
    expect(openClawConfig.agents?.defaults?.compaction?.memoryFlush).toBeUndefined();

    expect(memoryContent).not.toContain(BRIEFING_BEGIN_MARKER);
    expect(memoryContent).not.toContain(BRIEFING_END_MARKER);
    expect(memoryContent).toContain("## Goals");
    expect(memoryContent).toContain("## Notes");

    expect(logExists).toBe(true);
    expect(subjectsExists).toBe(true);
    expect(stateExists).toBe(true);
  });
});
