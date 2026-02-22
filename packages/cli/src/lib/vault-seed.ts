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

const STARTER_NOTE_FILENAME = "Zettelclaw Is Collaborative Memory For Your Agent.md"
const STARTER_RECLAW_FILENAME = "Use Reclaw To Import Old Conversation History.md"

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
    "tags: [agents, systems]",
    'summary: "Zettelclaw is collaborative memory for your agent and human partner."',
    'source: "https://zettelclaw.com"',
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "Zettelclaw is collaborative memory for your agent.",
    "",
    "It captures session context in journals and keeps durable knowledge in linked typed notes.",
    "",
  ].join("\n")
}

function buildStarterReclawInboxNote(dateStamp: string): string {
  return [
    "---",
    "type: evergreen",
    "tags: [imports, archives]",
    'summary: "Use Reclaw to import old conversation history into your Zettelclaw vault."',
    'source: "https://reclaw.sh"',
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "[Reclaw](https://reclaw.sh) imports old conversation history so you can bootstrap your vault with prior context.",
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
    "## Done",
    "- Zettelclaw setup and installed.",
    "",
    "## Decisions",
    "- Replaced the default OpenClaw memory workflow with Zettelclaw collaborative vault memory.",
    "",
    "## Facts",
    "",
    "## Open",
    "- Use [[Use Reclaw To Import Old Conversation History]] to import old conversation history.",
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
