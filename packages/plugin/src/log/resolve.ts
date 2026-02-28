import type { LogEntry } from "./schema";

function resolveLatestId(startId: string, replacementMap: Map<string, string>): string {
  let current = startId;
  const seen = new Set<string>([startId]);

  while (true) {
    const next = replacementMap.get(current);
    if (!next || seen.has(next)) {
      return current;
    }

    seen.add(next);
    current = next;
  }
}

export function buildReplacementMap(entries: LogEntry[]): Map<string, string> {
  const directMap = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.replaces) {
      continue;
    }

    directMap.set(entry.replaces, entry.id);
  }

  const resolvedMap = new Map<string, string>();
  for (const id of directMap.keys()) {
    const latestId = resolveLatestId(id, directMap);
    if (latestId !== id) {
      resolvedMap.set(id, latestId);
    }
  }

  return resolvedMap;
}

export function filterReplaced(
  entries: LogEntry[],
  opts: { includeReplaced?: boolean } = {},
): LogEntry[] {
  if (opts.includeReplaced) {
    return [...entries];
  }

  const replacementMap = buildReplacementMap(entries);
  return entries.filter((entry) => !replacementMap.has(entry.id));
}

export function getLatestVersion(entries: LogEntry[], id: string): LogEntry | undefined {
  const replacementMap = buildReplacementMap(entries);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const latestId = replacementMap.get(id) ?? id;
  return byId.get(latestId);
}
