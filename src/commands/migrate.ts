import { spawnSync } from "node:child_process"
import { cp, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { intro, log, select, spinner, text } from "@clack/prompts"

import { DEFAULT_OPENCLAW_WORKSPACE_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import { resolveUserPath } from "../lib/paths"
import { isDirectory, pathExists } from "../lib/vault"

type JsonRecord = Record<string, unknown>
const NOTES_FOLDER_CANDIDATES = ["01 Notes", "Notes"] as const
const JOURNAL_FOLDER_CANDIDATES = ["03 Journal", "02 Journal", "Daily", "Journal"] as const

export interface MigrateOptions {
  yes: boolean
  vaultPath?: string | undefined
  workspacePath?: string | undefined
  model?: string | undefined
}

interface ModelInfo {
  key: string
  name: string
  alias?: string
  isDefault: boolean
}

interface MemorySummary {
  files: string[]
  dailyFiles: string[]
  otherFiles: string[]
  dateRange: string
}

interface VaultLayout {
  notesFolder: string
  journalFolder: string
}

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord
  }

  return {}
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === "string")
}

function isDailyFile(filename: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.md$/u.test(filename)
}

function parseModels(json: string): ModelInfo[] {
  const parsed = asRecord(JSON.parse(json))
  const rawModels = Array.isArray(parsed.models) ? parsed.models : []

  return rawModels
    .map((rawModel) => {
      const model = asRecord(rawModel)
      const key = typeof model.key === "string" ? model.key : ""
      const name = typeof model.name === "string" && model.name.length > 0 ? model.name : key
      const tags = asStringArray(model.tags)
      const alias = tags.find((tag) => tag.startsWith("alias:"))?.slice(6)
      const result: ModelInfo = {
        key,
        name,
        isDefault: tags.includes("default"),
      }

      if (alias && alias.length > 0) {
        result.alias = alias
      }

      return result
    })
    .filter((model) => model.key.length > 0)
}

function selectYesModel(models: ModelInfo[]): ModelInfo {
  const firstModel = models[0]
  if (!firstModel) {
    throw new Error("OpenClaw returned no models")
  }

  const defaultModel = models.find((model) => model.isDefault) ?? firstModel
  const nonDefault = models.filter((model) => model.key !== defaultModel.key)

  if (nonDefault.length === 0) {
    return defaultModel
  }

  const selected =
    nonDefault.find((model) => model.name.toLowerCase().includes("free")) ??
    nonDefault.find((model) => {
      const haystack = [model.name, model.alias, model.key].filter((value) => typeof value === "string").join(" ")
      const normalized = haystack.toLowerCase()
      return normalized.includes("haiku") || normalized.includes("sonnet")
    }) ??
    nonDefault[0]

  return selected ?? defaultModel
}

function resolveRequestedModel(models: ModelInfo[], requested: string): ModelInfo | undefined {
  return models.find((model) => model.key === requested || model.alias === requested)
}

function substituteTemplate(template: string, values: Record<string, string>): string {
  let output = template
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, value)
  }
  return output
}

async function detectVaultFromOpenClawConfig(): Promise<string | undefined> {
  const configPath = resolveUserPath("~/.openclaw/openclaw.json")

  if (!(await pathExists(configPath))) {
    return undefined
  }

  try {
    const raw = await readFile(configPath, "utf8")
    const config = asRecord(JSON.parse(raw))
    const agents = asRecord(config.agents)
    const defaults = asRecord(agents.defaults)
    const memorySearch = asRecord(defaults.memorySearch)
    const extraPaths = Array.isArray(memorySearch.extraPaths) ? memorySearch.extraPaths : []

    for (const candidate of extraPaths) {
      if (typeof candidate !== "string") {
        continue
      }

      const resolvedCandidate = resolveUserPath(candidate)
      if (await looksLikeZettelclawVault(resolvedCandidate)) {
        return resolvedCandidate
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

async function promptVaultPath(): Promise<string> {
  const defaultPath = join(process.cwd(), "zettelclaw")

  return unwrapPrompt(
    await text({
      message: "Where is your Zettelclaw vault?",
      placeholder: toTildePath(defaultPath),
      defaultValue: defaultPath,
    }),
  )
}

async function detectVaultPath(options: MigrateOptions): Promise<string | undefined> {
  if (options.vaultPath) {
    return resolveUserPath(options.vaultPath)
  }

  const detected = await detectVaultFromOpenClawConfig()
  if (detected) {
    return detected
  }

  if (options.yes) {
    return undefined
  }

  return resolveUserPath(await promptVaultPath())
}

async function detectExistingFolder(vaultPath: string, candidates: readonly string[]): Promise<string | undefined> {
  for (const folder of candidates) {
    if (await isDirectory(join(vaultPath, folder))) {
      return folder
    }
  }

  return undefined
}

async function looksLikeZettelclawVault(vaultPath: string): Promise<boolean> {
  if (!(await isDirectory(vaultPath))) {
    return false
  }

  const notesFolder = await detectExistingFolder(vaultPath, NOTES_FOLDER_CANDIDATES)
  const journalFolder = await detectExistingFolder(vaultPath, JOURNAL_FOLDER_CANDIDATES)
  return typeof notesFolder === "string" && typeof journalFolder === "string"
}

async function detectVaultLayout(vaultPath: string): Promise<VaultLayout> {
  const notesFolder = await detectExistingFolder(vaultPath, NOTES_FOLDER_CANDIDATES)
  const journalFolder = await detectExistingFolder(vaultPath, JOURNAL_FOLDER_CANDIDATES)

  if (!(notesFolder && journalFolder)) {
    throw new Error(`Could not detect notes/journal folders in ${toTildePath(vaultPath)}. Is this a Zettelclaw vault?`)
  }

  return { notesFolder, journalFolder }
}

async function readMemorySummary(memoryPath: string): Promise<MemorySummary> {
  const entries = await readdir(memoryPath, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const dailyFiles = files.filter((filename) => isDailyFile(filename))
  const otherFiles = files.filter((filename) => !isDailyFile(filename))
  const sortedDates = dailyFiles.map((filename) => filename.slice(0, 10)).sort((a, b) => a.localeCompare(b))
  const dateRange = sortedDates.length > 0 ? `${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]}` : "n/a"

  return {
    files,
    dailyFiles,
    otherFiles,
    dateRange,
  }
}

async function chooseBackupPath(workspacePath: string): Promise<{ source: string; backup: string; label: string }> {
  const source = join(workspacePath, "memory")
  let index = 0

  while (true) {
    const label = index === 0 ? "memory.bak" : `memory.bak.${index}`
    const backup = join(workspacePath, label)

    if (!(await pathExists(backup))) {
      return { source, backup, label }
    }

    index += 1
  }
}

function readModelsFromOpenClaw(): ModelInfo[] {
  const result = spawnSync("openclaw", ["models", "list", "--json"], {
    encoding: "utf8",
    timeout: 10_000,
  })

  if (result.error || result.status !== 0 || !result.stdout) {
    throw new Error("Could not list models from OpenClaw. Is the gateway running?")
  }

  const models = parseModels(result.stdout)
  if (models.length === 0) {
    throw new Error("OpenClaw returned no models")
  }

  return models
}

async function chooseModel(models: ModelInfo[], options: MigrateOptions): Promise<ModelInfo> {
  if (models.length === 0) {
    throw new Error("OpenClaw returned no models")
  }

  if (options.model) {
    const selected = resolveRequestedModel(models, options.model)
    if (!selected) {
      throw new Error(`Model not found: ${options.model}`)
    }
    return selected
  }

  if (options.yes) {
    return selectYesModel(models)
  }

  const defaultModel = models.find((model) => model.isDefault) ?? models[0]
  if (!defaultModel) {
    throw new Error("OpenClaw returned no models")
  }
  const selectedKey = unwrapPrompt(
    await select({
      message: "Which model should sub-agents use for migration?",
      initialValue: defaultModel.key,
      options: models.map((model) => {
        const baseLabel = model.alias ? `${model.name} (${model.alias})` : `${model.name} (${model.key})`
        return {
          value: model.key,
          label: model.key === defaultModel.key ? `${baseLabel} — default` : baseLabel,
        }
      }),
    }),
  )

  const selected = models.find((model) => model.key === selectedKey)
  if (!selected) {
    throw new Error("Could not resolve selected model")
  }

  return selected
}

const MIGRATE_SESSION = "zettelclaw-migrate"

async function fireMigrateEvent(values: Record<string, string>): Promise<boolean> {
  const projectPath = join(import.meta.dirname, "../..")
  const templatePath = join(projectPath, "templates", "migrate-event.md")

  let template = ""
  try {
    template = await readFile(templatePath, "utf8")
  } catch {
    console.warn("[zettelclaw] Could not read migrate event template")
    return false
  }

  const eventText = substituteTemplate(template, values)
  const result = spawnSync(
    "openclaw",
    [
      "cron",
      "add",
      "--at",
      "+0s",
      "--session",
      "isolated",
      "--name",
      MIGRATE_SESSION,
      "--message",
      eventText,
      "--announce",
      "--delete-after-run",
      "--timeout-seconds",
      "1800",
    ],
    {
      encoding: "utf8",
      timeout: 15_000,
    },
  )

  return !result.error && result.status === 0
}

export async function runMigrate(options: MigrateOptions): Promise<void> {
  intro("🦞 Zettelclaw migration")

  const vaultPath = await detectVaultPath(options)
  if (!(vaultPath && (await isDirectory(vaultPath)))) {
    log.error("Could not find a Zettelclaw vault. Run `zettelclaw init` first.")
    return
  }

  const layout = await detectVaultLayout(vaultPath)
  const workspacePath = resolveUserPath(options.workspacePath ?? DEFAULT_OPENCLAW_WORKSPACE_PATH)
  const memoryPath = join(workspacePath, "memory")

  if (!(await isDirectory(memoryPath))) {
    log.error(`No memory directory found at ${toTildePath(memoryPath)}. Nothing to migrate.`)
    return
  }

  const summary = await readMemorySummary(memoryPath)
  if (summary.files.length === 0) {
    log.message("No memory markdown files found. Nothing to migrate.")
    return
  }

  log.message(
    [
      `Found ${summary.files.length} memory files to migrate`,
      `Date range: ${summary.dateRange}`,
      `Daily notes: ${summary.dailyFiles.length}`,
      `Other notes: ${summary.otherFiles.length}`,
    ].join("\n"),
  )

  const backup = await chooseBackupPath(workspacePath)
  try {
    await cp(backup.source, backup.backup, { recursive: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not back up memory directory: ${message}`)
  }
  log.success(`Backed up memory/ → ${backup.label}/`)

  const s = spinner()
  s.start("Loading available models")
  const models = readModelsFromOpenClaw()
  s.stop("Model list loaded")

  const selectedModel = await chooseModel(models, options)
  const modelLabel = selectedModel.alias ? `${selectedModel.name} (${selectedModel.alias})` : selectedModel.name
  log.message(`Using model: ${modelLabel}`)

  const sent = await fireMigrateEvent({
    vaultPath,
    workspacePath,
    model: selectedModel.key,
    notesFolder: layout.notesFolder,
    journalFolder: layout.journalFolder,
    fileCount: String(summary.files.length),
    dailyFiles: JSON.stringify(summary.dailyFiles),
    otherFiles: JSON.stringify(summary.otherFiles),
  })

  if (!sent) {
    log.warn("Could not fire migration event. Is the OpenClaw gateway running?")
    return
  }

  log.success(`Migration started! Your agent will process ${summary.files.length} files.`)
  log.message(`Watch progress with:\n  openclaw tui --session ${MIGRATE_SESSION}`)
}
