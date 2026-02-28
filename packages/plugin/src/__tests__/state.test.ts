import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isExtracted,
  markExtracted,
  markFailed,
  pruneState,
  readState,
  shouldRetry,
  writeState,
} from "../state";

describe("state", () => {
  let tempDir = "";
  let statePath = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zettelclaw-state-"));
    statePath = join(tempDir, "state.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("readState returns empty structure when missing", async () => {
    expect(await readState(statePath)).toEqual({
      extractedSessions: {},
      failedSessions: {},
    });
  });

  test("markExtracted records extraction and clears failure", async () => {
    await markFailed(statePath, "session-1", "temporary");
    await markExtracted(statePath, "session-1", 3);

    const state = await readState(statePath);
    expect(isExtracted(state, "session-1")).toBe(true);
    expect(state.extractedSessions["session-1"]?.entries).toBe(3);
    expect(state.failedSessions["session-1"]).toBeUndefined();
  });

  test("markFailed increments retries and shouldRetry reflects retry policy", async () => {
    let state = await readState(statePath);
    expect(shouldRetry(state, "session-2")).toBe(true);

    await markFailed(statePath, "session-2", "first error");
    state = await readState(statePath);

    expect(state.failedSessions["session-2"]?.retries).toBe(1);
    expect(shouldRetry(state, "session-2")).toBe(false);

    await markFailed(statePath, "session-2", "second error");
    state = await readState(statePath);
    expect(state.failedSessions["session-2"]?.retries).toBe(2);
  });

  test("pruneState removes entries older than cutoff", async () => {
    const oldAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const recentAt = new Date().toISOString();

    await writeState(statePath, {
      extractedSessions: {
        old: { at: oldAt, entries: 1 },
        recent: { at: recentAt, entries: 2 },
      },
      failedSessions: {
        old: { at: oldAt, error: "x", retries: 1 },
        recent: { at: recentAt, error: "y", retries: 1 },
      },
    });

    await pruneState(statePath);

    const state = await readState(statePath);
    expect(state.extractedSessions.old).toBeUndefined();
    expect(state.failedSessions.old).toBeUndefined();
    expect(state.extractedSessions.recent).toBeDefined();
    expect(state.failedSessions.recent).toBeDefined();
  });
});
