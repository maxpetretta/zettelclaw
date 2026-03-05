import { existsSync } from "node:fs"
import { copyFile, mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { FOLDERS, getVaultFolders } from "./folders"
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

function buildStarterJournalEntry(dateStamp: string): string {
  return [
    "---",
    "type: journal",
    "tags: []",
    `created: ${dateStamp}`,
    "---",
    "",
    "> [!agent] Daily briefing",
    "> - Vault installed and configured",
    "> - Inbox view available at `00 Inbox/inbox.base`",
    "> - Templates ready in `03 Templates/`",
    "",
    "## Done",
    "- Installed and configured Zettelclaw.",
    "",
    "## Decisions",
    "- This vault will be the shared long-term context between human and agent.",
    "",
    "## Learned",
    "- The inbox is a queue; durable notes belong in `01 Notes/`.",
    "",
    "## Open",
    "- Import clipper templates and test the first capture.",
    "",
  ].join("\n")
}

function pathIsInsideFolder(relativePath: string, folder: string): boolean {
  return relativePath === folder || relativePath.startsWith(`${folder}/`)
}

function remapSeedPath(relativePath: string): string | null {
  let mapped = relativePath

  if (mapped === "gitignore") {
    mapped = ".gitignore"
  }

  if (mapped === ".obsidian/workspace.template.json") {
    mapped = ".obsidian/workspace.json"
  }

  if (pathIsInsideFolder(mapped, "02 Agent")) {
    return null
  }

  if (mapped.startsWith("03 Journal/")) {
    mapped = mapped.replace("03 Journal/", `${FOLDERS.journal}/`)
  }

  if (mapped.startsWith("04 Templates/")) {
    mapped = mapped.replace("04 Templates/", `${FOLDERS.templates}/`)
  }

  if (mapped.startsWith("05 Attachments/")) {
    mapped = mapped.replace("05 Attachments/", `${FOLDERS.attachments}/`)
  }

  return mapped
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
    const mappedRelativePath = remapSeedPath(relativePath)

    if (!mappedRelativePath) {
      continue
    }

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

  await writeFileIfMissing(starterNotePath, buildStarterNote(dateStamp))
  await writeFileIfMissing(starterInboxPath, buildStarterInboxNote(dateStamp))
  await writeFileIfMissing(starterJournalPath, buildStarterJournalEntry(dateStamp))
}
