import { spawnSync } from "node:child_process"
import { cp, readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { intro, log, select, spinner, text } from "@clack/prompts"

import { DEFAULT_OPENCLAW_WORKSPACE_PATH, DEFAULT_VAULT_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import { JOURNAL_FOLDER_ALIASES, NOTES_FOLDER_CANDIDATES } from "../lib/folders"
import { asRecord, asStringArray } from "../lib/json"
import { resolveUserPath } from "../lib/paths"
import { substituteTemplate } from "../lib/template"
import { isDirectory, pathExists } from "../lib/vault"

const JOURNAL_FOLDER_CANDIDATES = [...JOURNAL_FOLDER_ALIASES]
const SKILL_TEMPLATE_DIR = join(import.meta.dirname, "..", "..", "skill", "templates")

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

function isDailyFile(filename: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.md$/u.test(filename)
}

function parseModels(json: string): ModelInfo[] {
  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(json)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`OpenClaw returned invalid model JSON: ${message}`)
  }

  const parsed = asRecord(parsedValue)
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
  const normalizedRequest = requested.trim().toLowerCase()

  return models.find((model) => {
    const candidates = [model.key, model.alias, model.name]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.toLowerCase())

    return candidates.includes(normalizedRequest)
  })
}

async function detectVaultFromOpenClawConfig(): Promise<string | undefined> {
  const configPath = resolveUserPath("~/.openclaw/openclaw.json")

  if (!(await pathExists(configPath))) {
    return undefined
  }

  try {
    const raw = await readFile(configPath, "utf8")
    const config = asRecord(JSON.parse(raw))
    const directMemorySearch = asRecord(config.memorySearch)
    const agents = asRecord(config.agents)
    const defaults = asRecord(agents.defaults)
    const defaultsMemorySearch = asRecord(defaults.memorySearch)

    const extraPathsCandidates = [directMemorySearch.extraPaths, defaultsMemorySearch.extraPaths]
    const extraPaths = extraPathsCandidates.flatMap((value) => (Array.isArray(value) ? value : []))

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
  const defaultPath = resolveUserPath(DEFAULT_VAULT_PATH)

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

async function chooseMemoryMdBackupPath(sourcePath: string): Promise<{ backupPath: string; label: string }> {
  const dir = dirname(sourcePath)
  const maxAttempts = 10_000

  for (let index = 0; index < maxAttempts; index += 1) {
    const label = index === 0 ? "MEMORY.md.bak" : `MEMORY.md.bak.${index}`
    const backupPath = join(dir, label)

    if (!(await pathExists(backupPath))) {
      return { backupPath, label }
    }
  }

  throw new Error(`Could not find an available backup path for MEMORY.md after ${maxAttempts} attempts`)
}

async function chooseBackupPath(workspacePath: string): Promise<{ source: string; backup: string; label: string }> {
  const source = join(workspacePath, "memory")
  const maxAttempts = 10_000

  for (let index = 0; index < maxAttempts; index += 1) {
    const label = index === 0 ? "memory.bak" : `memory.bak.${index}`
    const backup = join(workspacePath, label)

    if (!(await pathExists(backup))) {
      return { source, backup, label }
    }
  }

  throw new Error(
    `Could not find an available backup path under ${toTildePath(workspacePath)} after ${maxAttempts} attempts`,
  )
}

function readModelsFromOpenClaw(): ModelInfo[] {
  const result = spawnSync("openclaw", ["models", "list", "--json"], {
    encoding: "utf8",
    timeout: 10_000,
  })

  if (result.error) {
    throw new Error(`Could not list models from OpenClaw: ${result.error.message}`)
  }

  if (result.status !== 0 || !result.stdout) {
    const stderr = result.stderr?.trim()
    throw new Error(
      stderr ? `OpenClaw model list failed: ${stderr}` : "Could not list models from OpenClaw. Is the gateway running?",
    )
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
      const available = models.map((model) => (model.alias ? `${model.key} (${model.alias})` : model.key)).join(", ")
      throw new Error(`Model not found: ${options.model}. Available models: ${available}`)
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

const MIGRATE_SESSION_TARGET = "isolated"
const MIGRATE_JOB_NAME = "zettelclaw-migrate"

interface MigrateEventResult {
  sent: boolean
  jobId?: string
  message?: string
}

async function fireMigrateEvent(values: Record<string, string>): Promise<MigrateEventResult> {
  const templatePath = join(SKILL_TEMPLATE_DIR, "migrate-event.md")

  let template = ""
  try {
    template = await readFile(templatePath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { sent: false, message: `Could not read migrate template ${templatePath}: ${message}` }
  }

  const eventText = substituteTemplate(template, values)
  const result = spawnSync(
    "openclaw",
    [
      "cron",
      "add",
      "--at",
      "1s",
      "--session",
      MIGRATE_SESSION_TARGET,
      "--name",
      MIGRATE_JOB_NAME,
      "--message",
      eventText,
      "--announce",
      "--delete-after-run",
      "--timeout-seconds",
      "1800",
      "--json",
    ],
    {
      encoding: "utf8",
      timeout: 15_000,
    },
  )

  if (result.error) {
    return { sent: false, message: `Failed to schedule migration event: ${result.error.message}` }
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim()
    return { sent: false, message: stderr.length ? stderr : `openclaw cron add exited with code ${result.status}` }
  }

  try {
    const parsed = asRecord(JSON.parse(result.stdout))
    const jobId = typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : undefined
    return jobId ? { sent: true, jobId } : { sent: true }
  } catch {
    return { sent: true }
  }
}

export async function runMigrate(options: MigrateOptions): Promise<void> {
  intro("🦞 Migrate to Zettelclaw")

  const vaultPath = await detectVaultPath(options)
  if (!(vaultPath && (await isDirectory(vaultPath)))) {
    throw new Error("Could not find a Zettelclaw vault. Run `zettelclaw init` first.")
  }

  const layout = await detectVaultLayout(vaultPath)
  const workspacePath = resolveUserPath(options.workspacePath ?? DEFAULT_OPENCLAW_WORKSPACE_PATH)
  const memoryPath = join(workspacePath, "memory")

  if (!(await isDirectory(memoryPath))) {
    throw new Error(`No memory directory found at ${toTildePath(memoryPath)}. Nothing to migrate.`)
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

  // Back up MEMORY.md (migrate updates it)
  const memoryMdPath = join(workspacePath, "MEMORY.md")
  if (await pathExists(memoryMdPath)) {
    const memoryMdBak = await chooseMemoryMdBackupPath(memoryMdPath)
    try {
      await cp(memoryMdPath, memoryMdBak.backupPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not back up MEMORY.md: ${message}`)
    }
    log.success(`Backed up MEMORY.md → ${memoryMdBak.label}`)
  }

  const s = spinner()
  s.start("Loading available models")
  const models = readModelsFromOpenClaw()
  s.stop("Model list loaded")

  const selectedModel = await chooseModel(models, options)
  const modelLabel = selectedModel.alias ? `${selectedModel.name} (${selectedModel.alias})` : selectedModel.name
  log.message(`Using model: ${modelLabel}`)

  const eventResult = await fireMigrateEvent({
    vaultPath,
    workspacePath,
    model: selectedModel.key,
    notesFolder: layout.notesFolder,
    journalFolder: layout.journalFolder,
    fileCount: String(summary.files.length),
    dailyCount: String(summary.dailyFiles.length),
    otherCount: String(summary.otherFiles.length),
  })

  if (!eventResult.sent) {
    throw new Error(eventResult.message ?? "Could not fire migration event. Is the OpenClaw gateway running?")
  }

  log.success(`Migration started! Your agent will process ${summary.files.length} files.`)

  if (eventResult.jobId) {
    log.message(
      [
        "Watch progress with:",
        `  openclaw cron runs --id ${eventResult.jobId}`,
        `  openclaw tui --session ${MIGRATE_SESSION_TARGET}`,
      ].join("\n"),
    )
    return
  }

  log.message(`Watch progress with:\n  openclaw tui --session ${MIGRATE_SESSION_TARGET}`)
}
