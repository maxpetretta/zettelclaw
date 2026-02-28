import { describe, expect, test } from "bun:test";
import { buildReplacementMap, filterReplaced, getLatestVersion } from "../log/resolve";
import type { LogEntry } from "../log/schema";

const entries: LogEntry[] = [
  {
    id: "aaaaaaaaaaaa",
    timestamp: "2026-02-20T10:00:00.000Z",
    type: "fact",
    content: "Old fact",
    session: "s1",
  },
  {
    id: "bbbbbbbbbbbb",
    timestamp: "2026-02-21T10:00:00.000Z",
    type: "fact",
    content: "Updated fact",
    replaces: "aaaaaaaaaaaa",
    session: "s2",
  },
  {
    id: "cccccccccccc",
    timestamp: "2026-02-22T10:00:00.000Z",
    type: "fact",
    content: "Latest fact",
    replaces: "bbbbbbbbbbbb",
    session: "s3",
  },
  {
    id: "dddddddddddd",
    timestamp: "2026-02-23T10:00:00.000Z",
    type: "task",
    content: "Open item",
    status: "open",
    session: "s4",
  },
];

describe("resolve", () => {
  test("buildReplacementMap resolves transitive chains", () => {
    const map = buildReplacementMap(entries);

    expect(map.get("aaaaaaaaaaaa")).toBe("cccccccccccc");
    expect(map.get("bbbbbbbbbbbb")).toBe("cccccccccccc");
  });

  test("filterReplaced hides superseded entries by default", () => {
    const filtered = filterReplaced(entries);

    expect(filtered.map((entry) => entry.id)).toEqual(["cccccccccccc", "dddddddddddd"]);
  });

  test("filterReplaced returns all entries when includeReplaced is true", () => {
    const filtered = filterReplaced(entries, { includeReplaced: true });
    expect(filtered).toHaveLength(entries.length);
  });

  test("getLatestVersion returns the newest replacement", () => {
    const latest = getLatestVersion(entries, "aaaaaaaaaaaa");
    expect(latest?.id).toBe("cccccccccccc");
    expect(getLatestVersion(entries, "missing")).toBeUndefined();
  });
});
