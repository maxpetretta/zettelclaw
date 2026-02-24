import { existsSync } from "node:fs"
import { copyFile, mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { FOLDERS_WITH_AGENT, FOLDERS_WITHOUT_AGENT, getVaultFolders } from "./folders"
import { pathExists, walkFiles, writeFileIfMissing } from "./vault-fs"

export interface CopyResult {
  added: string[]
  skipped: string[]
  failed: string[]
}

export interface CopyVaultOptions {
  overwrite: boolean
  includeAgent: boolean
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

const STARTER_NOTE_FILENAME = "Zettelclaw Is Shared Human + Agent Memory.md"
const STARTER_RECLAW_FILENAME = "Reclaw Can Recover Memories From Old Chats.md"

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatLocalTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}

function buildStarterEvergreenNote(dateStamp: string): string {
  return [
    "---",
    "type: evergreen",
    "tags: [agents, systems, zettelkasten, obsidian, openclaw]",
    'summary: "Zettelclaw turns an Obsidian vault into shared human + agent memory that compounds over time."',
    'source: "https://zettelclaw.com"',
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "# Zettelclaw Is Shared Human + Agent Memory",
    "",
    "Zettelclaw gives you and your AI agent a shared memory system inside an Obsidian vault.",
    "",
    "Instead of letting insights disappear in long chat logs, it captures high-signal session context in journals and promotes durable knowledge into linked notes.",
    "",
    "## Why this works",
    "- Conversations fade. Knowledge compounds.",
    "- Notes are plain markdown, so your memory stays portable and inspectable.",
    "- Frontmatter turns notes into a simple API both humans and agents can read and write.",
    "",
    "## Memory flow",
    "1. Capture layer: OpenClaw hooks on `/new` and `/reset` append structured bullets (`Log`, `Todo`) into daily journal notes.",
    "2. Provenance layer: each session appends an entry under `## Sessions` so later claims can be traced back to when they were learned.",
    "3. Knowledge layer: humans and agents update typed notes in `01 Notes/` for lasting ideas.",
    "4. Maintenance layer: a nightly isolated pass reviews recent journals, updates existing notes, creates net-new inbox synthesis when needed, and enforces reciprocal links.",
    "",
    "## What `init` configures",
    "- A vault with templates for journal, evergreen, project, research, and contact notes.",
    "- Plugin setup (Templater, Linter, and Obsidian Git when Git sync is enabled).",
    "- OpenClaw integration when a workspace is detected (hooks, config patch, cron jobs, and agent symlinks).",
    "",
    "## Core commands",
    "- `npx zettelclaw init` to create and configure the vault.",
    "- `npx zettelclaw migrate` to import historical workspace memory files into the vault.",
    "- `npx zettelclaw verify` to programmatically check hooks, config, cron jobs, and skill wiring.",
    "",
    "## Related",
    "- [[Reclaw Can Recover Memories From Old Chats]]",
    "- https://zettelclaw.com",
    "- https://github.com/maxpetretta/zettelclaw",
    "",
  ].join("\n")
}

function buildStarterReclawInboxNote(dateStamp: string): string {
  return [
    "---",
    "type: evergreen",
    "tags: [imports, archives, migration, memory]",
    'summary: "Reclaw recovers durable memory from old ChatGPT, Claude, and Grok chats and can feed Zettelclaw journals."',
    'source: "https://reclaw.sh"',
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "# Reclaw Can Recover Memories From Old Chats",
    "",
    "Reclaw is designed to excavate durable knowledge from old AI chat exports before that context is lost.",
    "",
    "It supports ChatGPT, Claude, and Grok exports, then runs extraction and synthesis so past conversations become usable memory artifacts.",
    "",
    "## What Reclaw produces",
    "- OpenClaw mode (default): writes daily `memory/YYYY-MM-DD.md` files and updates `MEMORY.md` + `USER.md` with backups.",
    "- Zettelclaw mode (`--mode zettelclaw`): writes daily journals in `03 Journal/` and updates `MEMORY.md` + `USER.md` for your shared vault context.",
    "- Resumable runs with a state file so interrupted imports can continue safely.",
    "",
    "## Practical flow",
    "1. Export your chat history from provider settings (ChatGPT, Claude, or Grok).",
    "2. Run `npx reclaw` (or `npx reclaw --mode zettelclaw` when targeting this vault format).",
    "3. Use `npx reclaw status` to inspect resumable run state if needed.",
    "4. After import, run `npx zettelclaw verify` to confirm your local setup is healthy.",
    "",
    "## Useful flags",
    "- `--dry-run` / `--plan` to preview actions before writing files.",
    "- `--parallel-jobs <n>` to control extraction concurrency.",
    "- `--timestamped-backups` when repeating test imports.",
    "- `--workspace <path>` and `--target-path <path>` for explicit routing.",
    "",
    "## Links",
    "- https://reclaw.sh",
    "- https://github.com/maxpetretta/reclaw",
    "- https://github.com/maxpetretta/reclaw/blob/master/README.md",
    "",
  ].join("\n")
}

function buildStarterJournalEntry(dateStamp: string, timeStamp: string): string {
  return [
    "---",
    "type: journal",
    "tags: [journals]",
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "## Log",
    "- Zettelclaw setup and installed.",
    "- Replaced the default OpenClaw memory workflow with Zettelclaw collaborative vault memory.",
    "",
    "## Todo",
    "- Review [[Reclaw Can Recover Memories From Old Chats]] if you need to import historical chat context.",
    "",
    "---",
    "## Sessions",
    `- ZETTELCLAW-SETUP — ${timeStamp}`,
    "",
  ].join("\n")
}

function pathIsInsideFolder(relativePath: string, folder: string): boolean {
  return relativePath === folder || relativePath.startsWith(`${folder}/`)
}

function remapSeedPath(relativePath: string, options: CopyVaultOptions): string | null {
  let mapped = relativePath

  if (mapped === "gitignore") {
    mapped = ".gitignore"
  }

  if (mapped === ".obsidian/workspace.template.json") {
    mapped = ".obsidian/workspace.json"
  }

  if (!options.includeAgent) {
    if (pathIsInsideFolder(mapped, FOLDERS_WITH_AGENT.agent)) {
      return null
    }

    if (mapped.startsWith(`${FOLDERS_WITH_AGENT.journal}/`)) {
      mapped = mapped.replace(`${FOLDERS_WITH_AGENT.journal}/`, `${FOLDERS_WITHOUT_AGENT.journal}/`)
    }

    if (mapped.startsWith(`${FOLDERS_WITH_AGENT.templates}/`)) {
      mapped = mapped.replace(`${FOLDERS_WITH_AGENT.templates}/`, `${FOLDERS_WITHOUT_AGENT.templates}/`)
    }

    if (mapped.startsWith(`${FOLDERS_WITH_AGENT.attachments}/`)) {
      mapped = mapped.replace(`${FOLDERS_WITH_AGENT.attachments}/`, `${FOLDERS_WITHOUT_AGENT.attachments}/`)
    }
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
    const mappedRelativePath = remapSeedPath(relativePath, options)

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

export async function seedVaultStarterContent(vaultPath: string, includeAgent: boolean): Promise<void> {
  const folders = getVaultFolders(includeAgent)
  const now = new Date()
  const dateStamp = formatLocalDate(now)
  const timeStamp = formatLocalTime(now)

  const starterNotePath = join(vaultPath, folders.notes, STARTER_NOTE_FILENAME)
  const starterReclawPath = join(vaultPath, folders.inbox, STARTER_RECLAW_FILENAME)
  const starterJournalPath = join(vaultPath, folders.journal, `${dateStamp}.md`)

  await writeFileIfMissing(starterNotePath, buildStarterEvergreenNote(dateStamp))
  await writeFileIfMissing(starterReclawPath, buildStarterReclawInboxNote(dateStamp))
  await writeFileIfMissing(starterJournalPath, buildStarterJournalEntry(dateStamp, timeStamp))
}
