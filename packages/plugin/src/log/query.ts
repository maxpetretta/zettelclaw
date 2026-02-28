import { open } from "node:fs/promises";
import { spawn } from "node:child_process";
import { buildReplacementMap } from "./resolve";
import { readLog, type EntryType, type LogEntry, validateEntry } from "./schema";

export interface LogQueryFilter {
  type?: EntryType;
  subject?: string;
  status?: "open" | "done";
  session?: string;
  includeReplaced?: boolean;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function matchesKeyword(entry: LogEntry, keyword: string): boolean {
  const normalized = keyword.toLowerCase();
  return (
    entry.content.toLowerCase().includes(normalized) ||
    (entry.detail ? entry.detail.toLowerCase().includes(normalized) : false)
  );
}

function matchesFilter(entry: LogEntry, filter: LogQueryFilter): boolean {
  if (filter.type && entry.type !== filter.type) {
    return false;
  }

  if (filter.subject && entry.subject !== filter.subject) {
    return false;
  }

  if (filter.session && entry.session !== filter.session) {
    return false;
  }

  if (filter.status) {
    if (entry.type !== "task") {
      return false;
    }

    if (entry.status !== filter.status) {
      return false;
    }
  }

  return true;
}

function sortByTimestampDesc(a: LogEntry, b: LogEntry): number {
  return Date.parse(b.timestamp) - Date.parse(a.timestamp);
}

async function ripgrepSearch(logPath: string, keyword: string): Promise<Set<string> | null> {
  return await new Promise<Set<string> | null>((resolve) => {
    const child = spawn(
      "rg",
      ["--fixed-strings", "--ignore-case", "--line-number", "--no-heading", keyword, logPath],
      {
        stdio: ["ignore", "pipe", "ignore"],
      },
    );

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.on("error", () => {
      resolve(null);
    });

    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        resolve(null);
        return;
      }

      if (code === 1 || stdout.trim().length === 0) {
        resolve(new Set());
        return;
      }

      const ids = new Set<string>();
      for (const line of stdout.split("\n")) {
        if (!line.trim()) {
          continue;
        }

        const separatorIndex = line.indexOf(":");
        if (separatorIndex < 0) {
          continue;
        }

        const jsonLine = line.slice(separatorIndex + 1).trim();
        if (!jsonLine) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonLine);
        } catch {
          continue;
        }

        const validated = validateEntry(parsed);
        if (!validated.ok) {
          continue;
        }

        if (matchesKeyword(validated.entry, keyword)) {
          ids.add(validated.entry.id);
        }
      }

      resolve(ids);
    });
  });
}

function applyFilterAndResolution(
  allEntries: LogEntry[],
  candidateIds: Set<string> | null,
  filter: LogQueryFilter,
): LogEntry[] {
  const replacementMap = buildReplacementMap(allEntries);

  return allEntries
    .filter((entry) => {
      if (candidateIds && !candidateIds.has(entry.id)) {
        return false;
      }

      if (!filter.includeReplaced && replacementMap.has(entry.id)) {
        return false;
      }

      return matchesFilter(entry, filter);
    })
    .sort(sortByTimestampDesc);
}

function parseLine(line: string): LogEntry | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  const validated = validateEntry(parsed);
  return validated.ok ? validated.entry : undefined;
}

export async function queryLog(logPath: string, filter: LogQueryFilter): Promise<LogEntry[]> {
  const allEntries = await readLog(logPath);
  return applyFilterAndResolution(allEntries, null, filter);
}

export async function searchLog(
  logPath: string,
  keyword: string,
  filter: LogQueryFilter = {},
): Promise<LogEntry[]> {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) {
    return [];
  }

  const allEntries = await readLog(logPath);
  if (allEntries.length === 0) {
    return [];
  }

  const rgIds = await ripgrepSearch(logPath, trimmedKeyword);
  const fallbackIds =
    rgIds === null
      ? new Set(allEntries.filter((entry) => matchesKeyword(entry, trimmedKeyword)).map((entry) => entry.id))
      : rgIds;

  return applyFilterAndResolution(allEntries, fallbackIds, filter);
}

export async function getLastHandoff(logPath: string): Promise<LogEntry | undefined> {
  let fileHandle: Awaited<ReturnType<typeof open>>;

  try {
    fileHandle = await open(logPath, "r");
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }

    throw error;
  }

  try {
    const { size } = await fileHandle.stat();
    if (size === 0) {
      return undefined;
    }

    const chunkSize = 64 * 1024;
    let position = size;
    let remainder = "";

    while (position > 0) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;

      const buffer = Buffer.alloc(readSize);
      await fileHandle.read(buffer, 0, readSize, position);

      const text = buffer.toString("utf8") + remainder;
      const lines = text.split("\n");
      remainder = lines.shift() ?? "";

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const entry = parseLine(lines[index] ?? "");
        if (entry?.type === "handoff") {
          return entry;
        }
      }
    }

    const finalEntry = parseLine(remainder);
    if (finalEntry?.type === "handoff") {
      return finalEntry;
    }

    return undefined;
  } finally {
    await fileHandle.close();
  }
}
