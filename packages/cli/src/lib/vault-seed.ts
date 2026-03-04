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

function buildStarterEvergreenNote(dateStamp: string): string {
  return [
    "---",
    "type: evergreen",
    "tags: [zettelclaw, systems, knowledge]",
    'summary: "This vault works best when captures move from inbox to linked durable notes."',
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "",
    "# Zettelclaw Vault Principles",
    "",
    "Zettelclaw gives you an opinionated Obsidian setup where agent and human context stay in one place.",
    "",
    "## Core loop",
    "1. Capture quickly in `00 Inbox/` (including Web Clipper saves).",
    "2. Promote useful captures to typed notes in `01 Notes/`.",
    "3. Keep projects/research notes updated as work progresses.",
    "4. Use dashboards to keep reading and watch queues visible.",
    "",
    "## Note design rules",
    "- Prefer one idea per evergreen note.",
    "- Keep frontmatter accurate (`type`, `created`, `updated`).",
    "- Link related notes with `[[wikilinks]]`.",
    "- Treat `00 Inbox/` as transient and `01 Notes/` as durable.",
    "",
    "## OpenClaw integration",
    "- `memorySearch.extraPaths` in OpenClaw config points at this vault.",
    "",
    "## Related",
    "- [[Media Queues Dashboard]]",
    "",
  ].join("\n")
}

function buildStarterInboxNote(dateStamp: string): string {
  return [
    "---",
    "type: read-it-later",
    "status: inbox",
    "tags: [read-later, captures]",
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "",
    "# Build A Capture Habit",
    "",
    "Start small:",
    "- Save interesting links with the read-it-later clipper template.",
    "- Triage inbox items daily.",
    "- Promote only durable ideas into typed notes.",
    "",
    "## Next action",
    "- [ ] Import Web Clipper templates from `03 Templates/`.",
    "",
  ].join("\n")
}

function buildStarterJournalEntry(dateStamp: string): string {
  return [
    "---",
    "type: journal",
    "tags: [journals]",
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "",
    "## Done",
    "- Installed and configured Zettelclaw.",
    "",
    "## Decisions",
    "- This vault will be the shared long-term context between human and agent.",
    "",
    "## Facts",
    "- Web clipper templates are stored in `03 Templates/`.",
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

  await writeFileIfMissing(starterNotePath, buildStarterEvergreenNote(dateStamp))
  await writeFileIfMissing(starterInboxPath, buildStarterInboxNote(dateStamp))
  await writeFileIfMissing(starterJournalPath, buildStarterJournalEntry(dateStamp))
}
