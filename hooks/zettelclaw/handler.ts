import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { extractNotesFromConversation, type ExtractedNote } from "./lib/extract";
import { readRecentSessionMessages } from "./lib/session";
import { resolveVaultPath } from "./lib/vault-path";

interface HookEvent {
  type: string;
  action: string;
  sessionKey: string;
  timestamp: Date;
  messages: string[];
  context: {
    cfg?: any;
    sessionEntry?: any;
    previousSessionEntry?: any;
    sessionId?: string;
    sessionFile?: string;
    commandSource?: string;
    senderId?: string;
    workspaceDir?: string;
  };
}

type HookHandler = (event: HookEvent) => Promise<void>;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function logWarning(message: string): void {
  console.warn(`[zettelclaw hook] ${message}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function toDate(value: unknown): Date {
  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.valueOf())) {
      return parsed;
    }
  }

  return new Date();
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

function parseMessageCount(configValue: unknown): number {
  if (typeof configValue === "number" && Number.isFinite(configValue) && configValue > 0) {
    return Math.max(1, Math.floor(configValue));
  }

  if (typeof configValue === "string") {
    const parsed = Number.parseInt(configValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 20;
}

async function resolveNotesDirectory(vaultPath: string): Promise<string | null> {
  for (const folder of ["01 Notes", "Notes"]) {
    const candidate = join(vaultPath, folder);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function resolveJournalDirectory(vaultPath: string): Promise<string> {
  for (const folder of ["03 Journal", "02 Journal", "Journal", "Daily"]) {
    const candidate = join(vaultPath, folder);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return join(vaultPath, "03 Journal");
}

function sanitizeTitleForFilename(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTags(tags: string[]): string[] {
  const unique = new Set<string>();

  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase().replace(/\s+/g, "-");
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }

  return [...unique];
}

function buildNoteFrontmatter(note: ExtractedNote, dateStamp: string): string {
  const tags = normalizeTags(note.tags);
  const tagsValue = tags.map((tag) => JSON.stringify(tag)).join(", ");
  const summary = note.summary.trim().length > 0 ? note.summary.trim() : note.title;

  return [
    "---",
    "type: note",
    `tags: [${tagsValue}]`,
    `summary: ${JSON.stringify(summary)}`,
    `source: ${JSON.stringify(`[[${dateStamp}]]`)}`,
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "",
  ].join("\n");
}

async function writeExtractedNotes(
  notesDirectory: string,
  extractedNotes: ExtractedNote[],
  dateStamp: string,
): Promise<string[]> {
  const writtenTitles: string[] = [];

  for (const note of extractedNotes) {
    const safeTitle = sanitizeTitleForFilename(note.title);
    if (!safeTitle) {
      continue;
    }

    const notePath = join(notesDirectory, `${safeTitle}.md`);
    if (await pathExists(notePath)) {
      continue;
    }

    const frontmatter = buildNoteFrontmatter(note, dateStamp);
    const body = (note.body.trim().length > 0 ? note.body.trim() : note.summary.trim()).trim();
    const content = `${frontmatter}${body}\n`;

    await writeFile(notePath, content, "utf8");
    writtenTitles.push(safeTitle);
  }

  return writtenTitles;
}

async function appendJournalLog(vaultPath: string, timestamp: Date, titles: string[]): Promise<void> {
  const journalDir = await resolveJournalDirectory(vaultPath);
  const dateStamp = formatDate(timestamp);
  const timeStamp = formatTime(timestamp);
  const journalPath = join(journalDir, `${dateStamp}.md`);

  await mkdir(journalDir, { recursive: true });

  if (!(await pathExists(journalPath))) {
    const journalFrontmatter = [
      "---",
      "type: journal",
      "tags: [journals]",
      `created: ${dateStamp}`,
      `updated: ${dateStamp}`,
      "---",
      "",
      "## Notes",
      "",
    ].join("\n");

    await writeFile(journalPath, `${journalFrontmatter}\n`, "utf8");
  }

  let prefix = "\n";
  try {
    const existing = await readFile(journalPath, "utf8");
    if (existing.endsWith("\n\n")) {
      prefix = "";
    } else if (existing.endsWith("\n")) {
      prefix = "\n";
    } else {
      prefix = "\n\n";
    }
  } catch {
    prefix = "\n";
  }

  const links = titles.map((title) => `[[${title}]]`).join(", ");
  const section = [
    `## Session Reset (${timeStamp})`,
    `Extracted ${titles.length} notes: ${links}`,
    "",
  ].join("\n");

  await appendFile(journalPath, `${prefix}${section}`, "utf8");
}

function buildConversationTranscript(
  turns: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  return turns
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
    .join("\n\n")
    .trim();
}

export const handler: HookHandler = async (event) => {
  try {
    const isCommandNew =
      event.type === "command:new" || (event.type === "command" && event.action === "new");

    if (!isCommandNew) {
      return;
    }

    const cfg = event.context?.cfg ?? {};
    const hooks = asRecord(asRecord(asRecord(cfg).hooks).internal);
    const entries = asRecord(hooks.entries);
    const hookConfig = asRecord(entries.zettelclaw);
    const messageLimit = parseMessageCount(hookConfig.messages);

    const turns = await readRecentSessionMessages(event, messageLimit);
    if (turns.length === 0) {
      event.messages.push("🦞 No extractable insights from this session");
      return;
    }

    const vaultPath = await resolveVaultPath(cfg, hookConfig);
    if (!vaultPath) {
      logWarning("No vault path found; skipping extraction.");
      return;
    }

    const notesDirectory = await resolveNotesDirectory(vaultPath);
    if (!notesDirectory) {
      logWarning(`No Notes folder found in vault: ${vaultPath}`);
      return;
    }

    const transcript = buildConversationTranscript(turns);
    const extracted = await extractNotesFromConversation(transcript, {
      cfg,
      model: typeof hookConfig.model === "string" ? hookConfig.model : undefined,
      logger: logWarning,
    });

    if (extracted.length === 0) {
      event.messages.push("🦞 No extractable insights from this session");
      return;
    }

    const eventDate = toDate(event.timestamp);
    const dateStamp = formatDate(eventDate);
    const writtenTitles = await writeExtractedNotes(notesDirectory, extracted, dateStamp);

    if (writtenTitles.length === 0) {
      event.messages.push("🦞 No extractable insights from this session");
      return;
    }

    await appendJournalLog(vaultPath, eventDate, writtenTitles);
    event.messages.push(`🦞 Extracted ${writtenTitles.length} notes to vault: ${writtenTitles.join(", ")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Unexpected error: ${message}`);
  }
};

export default handler;
