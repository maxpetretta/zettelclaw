import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, readdir, readFile, stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { intro, log, select, spinner, text } from "@clack/prompts"

import { DEFAULT_OPENCLAW_WORKSPACE_PATH, DEFAULT_VAULT_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import { JOURNAL_FOLDER_ALIASES, NOTES_FOLDER_CANDIDATES } from "../lib/folders"
import { asRecord, asStringArray } from "../lib/json"
import { resolveUserPath } from "../lib/paths"
import { isDirectory, pathExists } from "../lib/vault"
import type { MigrateTask } from "../migrate/contracts"
import { runMigratePipeline } from "../migrate/pipeline"

const JOURNAL_FOLDER_CANDIDATES = [...JOURNAL_FOLDER_ALIASES]
const DEFAULT_MIGRATE_STATE_PATH = ".zettelclaw/migrate-state.json"
const DEFAULT_PARALLEL_JOBS = 5

export interface MigrateOptions {
  yes: boolean
  vaultPath?: string | undefined
  workspacePath?: string | undefined
  model?: string | undefined
  statePath?: string | undefined
  parallelJobs?: number | undefined
}

interface OpenClawWorkspaceEnv {
  stateDir: string
  configPath: string
}

interface ModelInfo {
  key: string
  name: string
  alias?: string
  isDefault: boolean
}

interface MemoryFileRecord {
  relativePath: string
  basename: string
  sourcePath: string
  sizeBytes: number
  mtimeMs: number
}

interface MemorySummary {
  files: MemoryFileRecord[]
  dailyFiles: MemoryFileRecord[]
  otherFiles: MemoryFileRecord[]
  dateRange: string
}

interface VaultLayout {
  notesFolder: string
  journalFolder: string
}

function resolveOpenClawEnvForWorkspace(workspacePath: string): OpenClawWorkspaceEnv {
  const openclawStateDir = dirname(workspacePath)
  return {
    stateDir: openclawStateDir,
    configPath: join(openclawStateDir, "openclaw.json"),
  }
}

function configureOpenClawEnvForWorkspace(workspacePath: string): OpenClawWorkspaceEnv {
  const env = resolveOpenClawEnvForWorkspace(workspacePath)
  process.env.OPENCLAW_STATE_DIR = env.stateDir
  process.env.OPENCLAW_CONFIG_PATH = env.configPath
  return env
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

async function readMarkdownFilesRecursive(memoryPath: string, relativeDir = ""): Promise<string[]> {
  const currentPath = relativeDir.length > 0 ? join(memoryPath, relativeDir) : memoryPath
  const entries = await readdir(currentPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const nextRelative = relativeDir.length > 0 ? `${relativeDir}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      files.push(...(await readMarkdownFilesRecursive(memoryPath, nextRelative)))
      continue
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(nextRelative)
    }
  }

  return files
}

async function readMemorySummary(memoryPath: string): Promise<MemorySummary> {
  const relativePaths = (await readMarkdownFilesRecursive(memoryPath)).sort((a, b) => a.localeCompare(b))
  const files: MemoryFileRecord[] = []

  for (const relativePath of relativePaths) {
    const sourcePath = join(memoryPath, relativePath)
    const metadata = await stat(sourcePath)
    files.push({
      relativePath,
      basename: basename(relativePath),
      sourcePath,
      sizeBytes: metadata.size,
      mtimeMs: metadata.mtimeMs,
    })
  }

  const dailyFiles = files.filter((file) => isDailyFile(file.basename))
  const otherFiles = files.filter((file) => !isDailyFile(file.basename))
  const sortedDates = dailyFiles.map((file) => file.basename.slice(0, 10)).sort((a, b) => a.localeCompare(b))
  const dateRange = sortedDates.length > 0 ? `${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]}` : "n/a"

  return {
    files,
    dailyFiles,
    otherFiles,
    dateRange,
  }
}

function buildMigrateTaskId(file: MemoryFileRecord): string {
  const hash = createHash("sha1")
  hash.update(file.relativePath)
  hash.update(String(file.sizeBytes))
  hash.update(String(Math.floor(file.mtimeMs)))
  return hash.digest("hex")
}

function buildMigrateTasks(files: MemoryFileRecord[]): MigrateTask[] {
  return files.map((file) => ({
    id: buildMigrateTaskId(file),
    relativePath: file.relativePath,
    basename: file.basename,
    sourcePath: file.sourcePath,
    kind: isDailyFile(file.basename) ? "daily" : "other",
  }))
}

async function chooseFileBackupPath(sourcePath: string): Promise<{ backupPath: string; label: string }> {
  const dir = dirname(sourcePath)
  const sourceBase = basename(sourcePath)
  const maxAttempts = 10_000

  for (let index = 0; index < maxAttempts; index += 1) {
    const label = index === 0 ? `${sourceBase}.bak` : `${sourceBase}.bak.${index}`
    const backupPath = join(dir, label)

    if (!(await pathExists(backupPath))) {
      return { backupPath, label }
    }
  }

  throw new Error(`Could not find an available backup path for ${sourceBase} after ${maxAttempts} attempts`)
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
      message: "Which model should migration agents use?",
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

function resolveMigrateStatePath(options: MigrateOptions, workspacePath: string): string {
  if (options.statePath) {
    return resolveUserPath(options.statePath)
  }

  return join(workspacePath, DEFAULT_MIGRATE_STATE_PATH)
}

function resolveParallelJobs(options: MigrateOptions): number {
  if (typeof options.parallelJobs !== "number" || !Number.isFinite(options.parallelJobs)) {
    return DEFAULT_PARALLEL_JOBS
  }

  const normalized = Math.floor(options.parallelJobs)
  if (normalized < 1) {
    return 1
  }

  return normalized
}

export async function runMigrate(options: MigrateOptions): Promise<void> {
  intro("🦞 Migrate to Zettelclaw")

  const vaultPath = await detectVaultPath(options)
  if (!(vaultPath && (await isDirectory(vaultPath)))) {
    throw new Error("Could not find a Zettelclaw vault. Run `zettelclaw init` first.")
  }

  const layout = await detectVaultLayout(vaultPath)
  const workspacePath = resolveUserPath(options.workspacePath ?? DEFAULT_OPENCLAW_WORKSPACE_PATH)
  configureOpenClawEnvForWorkspace(workspacePath)
  const memoryPath = join(workspacePath, "memory")
  const statePath = resolveMigrateStatePath(options, workspacePath)

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

  const memoryMdPath = join(workspacePath, "MEMORY.md")
  if (await pathExists(memoryMdPath)) {
    const memoryBackup = await chooseFileBackupPath(memoryMdPath)
    try {
      await cp(memoryMdPath, memoryBackup.backupPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not back up MEMORY.md: ${message}`)
    }
    log.success(`Backed up MEMORY.md → ${memoryBackup.label}`)
  }

  const userMdPath = join(workspacePath, "USER.md")
  if (await pathExists(userMdPath)) {
    const userBackup = await chooseFileBackupPath(userMdPath)
    try {
      await cp(userMdPath, userBackup.backupPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not back up USER.md: ${message}`)
    }
    log.success(`Backed up USER.md → ${userBackup.label}`)
  }

  const s = spinner()
  s.start("Loading available models")
  const models = readModelsFromOpenClaw()
  s.stop("Model list loaded")

  const selectedModel = await chooseModel(models, options)
  const modelLabel = selectedModel.alias ? `${selectedModel.name} (${selectedModel.alias})` : selectedModel.name
  log.message(`Using model: ${modelLabel}`)

  const tasks = buildMigrateTasks(summary.files)
  const progressSpinner = spinner()
  progressSpinner.start("Migration in progress")
  let lastProgressMessage = ""

  let result: Awaited<ReturnType<typeof runMigratePipeline>>
  try {
    result = await runMigratePipeline({
      workspacePath,
      memoryPath,
      vaultPath,
      notesFolder: layout.notesFolder,
      journalFolder: layout.journalFolder,
      model: selectedModel.key,
      statePath,
      tasks,
      parallelJobs: resolveParallelJobs(options),
      onProgress: (message) => {
        if (message === lastProgressMessage) {
          return
        }
        lastProgressMessage = message
        progressSpinner.message(message)
      },
    })
  } catch (error) {
    progressSpinner.stop("Migration failed")
    throw error
  }

  progressSpinner.stop(
    `Migration complete (${result.processedTasks + result.skippedTasks}/${result.totalTasks} files processed)`,
  )

  if (result.failedTasks > 0) {
    const failurePreview = result.failedTaskErrors
      .slice(0, 5)
      .map((entry) => `- ${entry}`)
      .join("\n")
    throw new Error(
      `Migration failed for ${result.failedTasks} files.\n${failurePreview}${
        result.failedTaskErrors.length > 5 ? "\n- ... additional failures omitted" : ""
      }`,
    )
  }

  if (!result.cleanupCompleted) {
    throw new Error("Migration finished but workspace memory cleanup did not complete.")
  }

  if (result.finalSynthesisSummary.trim().length > 0) {
    log.message(`Final synthesis summary:\n${result.finalSynthesisSummary.trim()}`)
  }

  log.success("Migration finished. Workspace memory files were migrated and cleared.")
  log.message(`State file: ${toTildePath(result.statePath)}`)
}
