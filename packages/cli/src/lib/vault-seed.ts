import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { getVaultFolders } from "./folders"
import { substituteTemplate } from "./template"
import { pathExists, walkFiles, writeFileIfMissing } from "./vault-fs"

export interface CopyResult {
  added: string[]
  skipped: string[]
  failed: string[]
}

export interface CopyVaultOptions {
  overwrite: boolean
}

const TEMPLATE_ROOT = (() => {
  const candidates = [
    resolve(import.meta.dirname, "..", "..", "vault"),
    resolve(import.meta.dirname, "..", "vault"),
  ] as const
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0]
})()

const STARTER_NOTE_FILENAME = "Zettelclaw Vault Principles.md"
const STARTER_INBOX_FILENAME = "Build A Capture Habit.md"
const STARTER_JOURNAL_TEMPLATE_PATH = join(TEMPLATE_ROOT, "03 Templates", "journal.md")

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function buildStarterNote(dateStamp: string): string {
  return [
    "---",
    "type: note",
    "tags: [zettelclaw, systems, knowledge]",
    `created: ${dateStamp}`,
    "---",
    "",
    "# Zettelclaw Vault Principles",
    "",
    "Zettelclaw gives you an opinionated Obsidian setup where agent and human context stay in one place.",
    "",
    "## Core loop",
    "1. Capture quickly in `00 Inbox/` (including Web Clipper saves).",
    "2. Process inbox items: keep (`status: queued`), write a note, or discard.",
    "3. Write durable ideas as `type: note` in `01 Notes/`.",
    "4. Link concepts aggressively with `[[wikilinks]]`.",
    "",
    "## Note design rules",
    "- Prefer one atomic idea per note.",
    "- Keep frontmatter accurate (`type`, `tags`, `created`, plus `status` for docs/content).",
    "- Link related notes with `[[wikilinks]]`.",
    "- Treat `00 Inbox/` as transient and `01 Notes/` as durable.",
    "",
    "## OpenClaw integration",
    "- `agents.defaults.memorySearch.extraPaths` in OpenClaw config points at this vault.",
  ].join("\n")
}

function buildStarterInboxNote(dateStamp: string): string {
  return [
    "---",
    "type: article",
    "status: queued",
    "tags: [workflow, learning]",
    "source: https://obsidian.md",
    `created: ${dateStamp}`,
    "---",
    "",
    "# Build A Capture Habit",
    "",
    "Start small:",
    "- Save interesting links with the universal capture clipper template.",
    "- Process inbox items regularly.",
    "- Write a durable `type: note` when a source triggers original thinking.",
    "",
    "## Next action",
    "- [ ] Process `00 Inbox/` and decide what to keep, convert, or discard.",
    "",
  ].join("\n")
}

async function buildStarterJournalEntry(vaultPath: string, dateStamp: string): Promise<string> {
  const folders = getVaultFolders()
  const vaultTemplatePath = join(vaultPath, folders.templates, "journal.md")
  const templatePath = (await pathExists(vaultTemplatePath)) ? vaultTemplatePath : STARTER_JOURNAL_TEMPLATE_PATH
  const template = await readFile(templatePath, "utf8")

  return substituteTemplate(template, {
    "date:YYYY-MM-DD": dateStamp,
  })
}

function normalizeSeedPath(relativePath: string): string {
  if (relativePath === "gitignore") {
    return ".gitignore"
  }

  if (relativePath === ".obsidian/workspace.template.json") {
    return ".obsidian/workspace.json"
  }

  return relativePath
}

export async function copyVaultSeed(vaultPath: string, options: CopyVaultOptions): Promise<CopyResult> {
  await mkdir(vaultPath, { recursive: true })

  const files = await walkFiles(TEMPLATE_ROOT)
  const result: CopyResult = {
    added: [],
    skipped: [],
    failed: [],
  }

  for (const relativePath of files) {
    const mappedRelativePath = normalizeSeedPath(relativePath)

    const source = join(TEMPLATE_ROOT, ...relativePath.split("/"))
    const destination = join(vaultPath, ...mappedRelativePath.split("/"))

    await mkdir(dirname(destination), { recursive: true })

    const exists = await pathExists(destination)

    if (exists && !options.overwrite) {
      result.skipped.push(mappedRelativePath)
      continue
    }

    await copyFile(source, destination)
    result.added.push(mappedRelativePath)
  }

  return result
}

export async function seedVaultStarterContent(vaultPath: string): Promise<void> {
  const folders = getVaultFolders()
  const now = new Date()
  const dateStamp = formatLocalDate(now)

  const starterNotePath = join(vaultPath, folders.notes, STARTER_NOTE_FILENAME)
  const starterInboxPath = join(vaultPath, folders.inbox, STARTER_INBOX_FILENAME)
  const starterJournalPath = join(vaultPath, folders.journal, `${dateStamp}.md`)
  const starterJournalEntry = await buildStarterJournalEntry(vaultPath, dateStamp)

  await writeFileIfMissing(starterNotePath, buildStarterNote(dateStamp))
  await writeFileIfMissing(starterInboxPath, buildStarterInboxNote(dateStamp))
  await writeFileIfMissing(starterJournalPath, starterJournalEntry)
}
