import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTranscriptFile, formatTranscript, readTranscript } from "../lib/transcript";

describe("transcript", () => {
  let tempDir = "";
  let originalOpenClawHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zettelclaw-transcript-"));
    originalOpenClawHome = process.env.OPENCLAW_HOME;
    process.env.OPENCLAW_HOME = tempDir;
  });

  afterEach(async () => {
    if (originalOpenClawHome === undefined) {
      delete process.env.OPENCLAW_HOME;
    } else {
      process.env.OPENCLAW_HOME = originalOpenClawHome;
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  test("readTranscript parses user/assistant messages from JSONL", async () => {
    const sessionFile = join(tempDir, "sample.jsonl");

    await writeFile(
      sessionFile,
      [
        '{"type":"session","version":3,"id":"s1","timestamp":"2026-02-20T00:00:00.000Z"}',
        '{"type":"message","timestamp":"2026-02-20T00:01:00.000Z","message":{"role":"user","content":"Need a retry strategy"}}',
        '{"type":"message","timestamp":"2026-02-20T00:02:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Use exponential backoff."}]}}',
        '{"type":"message","timestamp":"2026-02-20T00:03:00.000Z","message":{"role":"tool","content":"tool output"}}',
      ].join("\n"),
      "utf8",
    );

    const messages = await readTranscript(sessionFile);

    expect(messages).toEqual([
      {
        role: "user",
        content: "Need a retry strategy",
        timestamp: "2026-02-20T00:01:00.000Z",
      },
      {
        role: "assistant",
        content: "Use exponential backoff.",
        timestamp: "2026-02-20T00:02:00.000Z",
      },
    ]);
  });

  test("findTranscriptFile prefers the primary file", async () => {
    const sessionsDir = join(tempDir, "agents", "agent-a", "sessions");
    const primary = join(sessionsDir, "session-1.jsonl");
    const reset = join(sessionsDir, "session-1.reset.2026-02-20.jsonl");

    await Bun.write(primary, "");
    await Bun.write(reset, "");

    const found = await findTranscriptFile("agent-a", "session-1");
    expect(found).toBe(primary);
  });

  test("findTranscriptFile falls back to most recent reset variant", async () => {
    const sessionsDir = join(tempDir, "agents", "agent-b", "sessions");
    const older = join(sessionsDir, "session-2.reset.2026-02-20T01:00:00Z.jsonl");
    const newer = join(sessionsDir, "session-2.jsonl.reset.2026-02-20T02:00:00Z");

    await Bun.write(older, "");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await Bun.write(newer, "");

    const found = await findTranscriptFile("agent-b", "session-2");
    expect(found).toBe(newer);
  });

  test("formatTranscript returns role-prefixed text lines", () => {
    const formatted = formatTranscript([
      {
        role: "user",
        content: "hello",
        timestamp: "2026-02-20T00:00:00.000Z",
      },
      {
        role: "assistant",
        content: "world",
        timestamp: "2026-02-20T00:01:00.000Z",
      },
    ]);

    expect(formatted).toBe("user: hello\nassistant: world");
  });
});
