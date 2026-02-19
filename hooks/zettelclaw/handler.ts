import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { extractSessionSummary, type ExtractedNote, type SessionSummary } from "./lib/extract";
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

function renderBullets(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item) => item.startsWith("- ") ? item : `- ${item}`).join("\n");
}

async function writeJournalEntry(vaultPath: string, timestamp: Date, summary: SessionSummary): Promise<void> {
  const journalDir = await resolveJournalDirectory(vaultPath);
  const dateStamp = formatDate(timestamp);
  const journalPath = join(journalDir, `${dateStamp}.md`);

  await mkdir(journalDir, { recursive: true });

  const isNew = !(await pathExists(journalPath));

  if (isNew) {
    // Create journal using the template format
    const sections: string[] = [
      "---",
      "type: journal",
      "tags: [journals]",
      `created: ${dateStamp}`,
      `updated: ${dateStamp}`,
      "---",
      "",
    ];

    if (summary.done.length > 0) {
      sections.push("## Done", "", renderBullets(summary.done), "");
    } else {
      sections.push("## Done", "", "");
    }

    if (summary.decisions.length > 0) {
      sections.push("## Decisions", "", renderBullets(summary.decisions), "");
    } else {
      sections.push("## Decisions", "", "");
    }

    if (summary.open.length > 0) {
      sections.push("## Open", "", renderBullets(summary.open), "");
    } else {
      sections.push("## Open", "", "");
    }

    if (summary.journalNotes.length > 0 || summary.notes.length > 0) {
      const noteItems = [...summary.journalNotes];
      if (summary.notes.length > 0) {
        const links = summary.notes.map((n) => `[[${n.title}]]`).join(", ");
        noteItems.push(`Extracted notes: ${links}`);
      }
      sections.push("## Notes", "", renderBullets(noteItems), "");
    } else {
      sections.push("## Notes", "", "");
    }

    await writeFile(journalPath, sections.join("\n"), "utf8");
  } else {
    // Append to existing journal — add bullets under the right sections
    const existing = await readFile(journalPath, "utf8");
    let updated = existing;

    // Update the `updated` frontmatter field
    updated = updated.replace(/^(updated:\s*).+$/m, `$1${dateStamp}`);

    // Helper: append bullets before the next ## heading or EOF
    function appendToSection(content: string, heading: string, bullets: string[]): string {
      if (bullets.length === 0) return content;
      const rendered = renderBullets(bullets);
      const headingPattern = new RegExp(`(## ${heading}[\\s\\S]*?)(\n## |$)`);
      const match = content.match(headingPattern);
      if (match) {
        const sectionEnd = match.index! + match[1].length;
        const before = content.slice(0, sectionEnd).trimEnd();
        const after = content.slice(sectionEnd);
        return `${before}\n${rendered}\n${after}`;
      }
      // Section doesn't exist — append it
      return `${content.trimEnd()}\n\n## ${heading}\n\n${rendered}\n`;
    }

    updated = appendToSection(updated, "Done", summary.done);
    updated = appendToSection(updated, "Decisions", summary.decisions);
    updated = appendToSection(updated, "Open", summary.open);

    const noteItems = [...summary.journalNotes];
    if (summary.notes.length > 0) {
      const links = summary.notes.map((n) => `[[${n.title}]]`).join(", ");
      noteItems.push(`Extracted notes: ${links}`);
    }
    updated = appendToSection(updated, "Notes", noteItems);

    await writeFile(journalPath, updated, "utf8");
  }
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
    const eventDate = toDate(event.timestamp);
    const dateStamp = formatDate(eventDate);

    // Journal entry is ALWAYS written — it's the primary output of the hook.
    // Atomic notes are only created when a genuinely reusable concept was discussed.
    const result = await extractSessionSummary(transcript, {
      cfg,
      model: typeof hookConfig.model === "string" ? hookConfig.model : undefined,
      logger: logWarning,
    });

    // Write/update journal entry (always)
    await writeJournalEntry(vaultPath, eventDate, result);

    // Write atomic notes only if any were extracted
    let writtenTitles: string[] = [];
    if (result.notes.length > 0) {
      writtenTitles = await writeExtractedNotes(notesDirectory, result.notes, dateStamp);
    }

    if (writtenTitles.length > 0) {
      event.messages.push(`🦞 Journal updated, extracted ${writtenTitles.length} notes: ${writtenTitles.join(", ")}`);
    } else {
      event.messages.push("🦞 Journal updated");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Unexpected error: ${message}`);
  }
};

export default handler;
