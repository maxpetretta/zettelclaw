import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEntry, type LogEntry } from "../log/schema";
import { getLastHandoff, queryLog, searchLog } from "../log/query";

describe("query", () => {
  let tempDir = "";
  let logPath = "";

  const seedEntries: LogEntry[] = [
    {
      id: "qid000000001",
      timestamp: "2026-02-20T08:00:00.000Z",
      type: "question",
      content: "Is webhook retry enough?",
      subject: "auth-migration",
      session: "s1",
    },
    {
      id: "did000000001",
      timestamp: "2026-02-21T08:00:00.000Z",
      type: "decision",
      content: "Use queue-based webhook retries",
      detail: "staging verified",
      subject: "auth-migration",
      replaces: "qid000000001",
      session: "s2",
    },
    {
      id: "tidopen00001",
      timestamp: "2026-02-22T08:00:00.000Z",
      type: "task",
      content: "Backfill failed webhook jobs",
      status: "open",
      subject: "auth-migration",
      session: "s3",
    },
    {
      id: "tiddone00001",
      timestamp: "2026-02-23T08:00:00.000Z",
      type: "task",
      content: "Load test webhook queue",
      status: "done",
      subject: "auth-migration",
      session: "s4",
    },
    {
      id: "hid000000001",
      timestamp: "2026-02-24T08:00:00.000Z",
      type: "handoff",
      content: "Initial handoff",
      detail: "open backfill task",
      subject: "auth-migration",
      session: "s5",
    },
    {
      id: "hid000000002",
      timestamp: "2026-02-25T08:00:00.000Z",
      type: "handoff",
      content: "Latest handoff",
      detail: "queue is stable",
      subject: "auth-migration",
      session: "s6",
    },
  ];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zettelclaw-query-"));
    logPath = join(tempDir, "log.jsonl");

    for (const entry of seedEntries) {
      await appendEntry(logPath, entry);
    }
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("queryLog applies structured filters and replacement resolution", async () => {
    const openTasks = await queryLog(logPath, { type: "task", status: "open" });
    expect(openTasks.map((entry) => entry.id)).toEqual(["tidopen00001"]);

    const questions = await queryLog(logPath, { type: "question" });
    expect(questions).toHaveLength(0);

    const allQuestions = await queryLog(logPath, { type: "question", includeReplaced: true });
    expect(allQuestions.map((entry) => entry.id)).toEqual(["qid000000001"]);
  });

  test("searchLog finds keyword matches and supports fallback when ripgrep is unavailable", async () => {
    const withRg = await searchLog(logPath, "webhook", { subject: "auth-migration" });
    expect(withRg.map((entry) => entry.id)).toEqual([
      "tiddone00001",
      "tidopen00001",
      "did000000001",
    ]);

    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const withoutRg = await searchLog(logPath, "staging");
      expect(withoutRg.map((entry) => entry.id)).toEqual(["did000000001"]);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  test("getLastHandoff returns the most recent handoff entry", async () => {
    const last = await getLastHandoff(logPath);
    expect(last?.id).toBe("hid000000002");
  });
});
