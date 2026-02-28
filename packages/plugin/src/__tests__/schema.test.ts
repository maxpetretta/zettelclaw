import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEntry,
  generateId,
  injectMeta,
  readLog,
  validateEntry,
  validateLlmOutput,
  type LogEntry,
} from "../log/schema";

describe("schema", () => {
  let tempDir = "";
  let logPath = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zettelclaw-schema-"));
    logPath = join(tempDir, "log.jsonl");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("generateId creates a 12-character id", () => {
    expect(generateId()).toHaveLength(12);
  });

  test("validateEntry accepts a valid task entry", () => {
    const raw: LogEntry = {
      id: "abcdefghijkl",
      timestamp: new Date().toISOString(),
      type: "task",
      content: "Ship plugin",
      session: "session-1",
      status: "open",
    };

    const validated = validateEntry(raw);
    expect(validated.ok).toBe(true);
  });

  test("validateLlmOutput rejects meta fields", () => {
    const validated = validateLlmOutput({
      id: "abcdefghijkl",
      type: "fact",
      content: "bad",
    });

    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.error).toContain("must not include id, timestamp, or session");
    }
  });

  test("injectMeta adds id, timestamp, and session", () => {
    const entry = injectMeta(
      {
        type: "decision",
        content: "Use JSONL",
        detail: "Simple append-only log",
      },
      "session-2",
    );

    expect(entry.id).toHaveLength(12);
    expect(entry.session).toBe("session-2");
    expect(entry.timestamp).toContain("T");
  });

  test("appendEntry/readLog round trip", async () => {
    const first = injectMeta(
      {
        type: "task",
        content: "Write tests",
        status: "open",
      },
      "session-3",
    );

    const second = injectMeta(
      {
        type: "fact",
        content: "Tests use bun:test",
      },
      "session-3",
    );

    await appendEntry(logPath, first);
    await appendEntry(logPath, second);

    const entries = await readLog(logPath);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.id).toBe(first.id);
    expect(entries[1]?.id).toBe(second.id);
  });
});
