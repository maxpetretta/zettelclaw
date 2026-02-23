import { createHash } from "node:crypto"
import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { asRecord, type JsonRecord } from "./json"
import { runOpenClawCommand } from "./openclaw-command"
import {
  isCronJobEnabled,
  parseCronJobs,
  readCronJobExpression,
  readCronJobId,
  readCronJobMessage,
  readCronJobSession,
  readCronJobTimeZone,
} from "./openclaw-cron"
import { resolveSkillPackageDir, resolveSkillPath } from "./skill"
import { substituteTemplate } from "./template"
import { pathExists } from "./vault-fs"

const HOOK_SOURCE_DIR = resolveSkillPath("hooks", "zettelclaw")
const TEMPLATE_SOURCE_DIR = resolveSkillPath("templates")
const SWEEP_CRON_JOB_NAME = "zettelclaw-reset"
const SWEEP_CRON_EXPRESSION = "0 2 * * *"
const SWEEP_CRON_SESSION = "isolated"
const SWEEP_CRON_MESSAGE = "/reset"
const NIGHTLY_MAINTENANCE_CRON_JOB_NAME = "zettelclaw-nightly"
const NIGHTLY_MAINTENANCE_CRON_EXPRESSION = "0 3 * * *"
const NIGHTLY_MAINTENANCE_CRON_SESSION = "isolated"
const NIGHTLY_MAINTENANCE_CRON_TIMEOUT_SECONDS = "900"
const NIGHTLY_MAINTENANCE_TEMPLATE = "nightly-maintenance-event.md"

function coerceHookEntry(value: unknown): JsonRecord {
  if (typeof value === "boolean") {
    return { enabled: value }
  }

  return asRecord(value)
}

export interface HookInstallResult {
  status: "installed" | "skipped" | "failed"
  message?: string
}

async function hookInstallLooksValid(hookPath: string): Promise<boolean> {
  return (await pathExists(join(hookPath, "HOOK.md"))) && (await pathExists(join(hookPath, "handler.ts")))
}

async function listFilesRecursive(rootPath: string, relativePath = ""): Promise<string[]> {
  const absolutePath = relativePath.length > 0 ? join(rootPath, relativePath) : rootPath
  const entries = await readdir(absolutePath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const nextRelative = relativePath.length > 0 ? `${relativePath}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(rootPath, nextRelative)))
      continue
    }

    if (entry.isFile()) {
      files.push(nextRelative)
    }
  }

  return files
}

async function computeDirectoryHash(pathToDir: string): Promise<string> {
  const hash = createHash("sha256")
  const files = (await listFilesRecursive(pathToDir)).sort((left, right) => left.localeCompare(right))

  for (const relativeFile of files) {
    const content = await readFile(join(pathToDir, relativeFile))
    hash.update(relativeFile)
    hash.update("\u0000")
    hash.update(content)
    hash.update("\u0000")
  }

  return hash.digest("hex")
}

export async function installOpenClawHook(openclawDir: string): Promise<HookInstallResult> {
  const hookPath = join(openclawDir, "hooks", "zettelclaw")

  try {
    if (!(await pathExists(HOOK_SOURCE_DIR))) {
      return { status: "failed", message: `Missing bundled hook at ${HOOK_SOURCE_DIR}` }
    }

    const sourceHash = await computeDirectoryHash(HOOK_SOURCE_DIR)

    if (await pathExists(hookPath)) {
      const existingStats = await lstat(hookPath)

      if (existingStats.isDirectory() && (await hookInstallLooksValid(hookPath))) {
        const installedHash = await computeDirectoryHash(hookPath)
        if (installedHash === sourceHash) {
          return { status: "skipped" }
        }
      }

      // Remove partial or invalid installs and replace with the bundled hook.
      await rm(hookPath, { recursive: true, force: true })
    }

    await mkdir(dirname(hookPath), { recursive: true })
    await cp(HOOK_SOURCE_DIR, hookPath, { recursive: true })
    return { status: "installed" }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: "failed", message: `Could not install hook to ${hookPath}: ${message}` }
  }
}

export interface ConfigPatchResult {
  changed: boolean
  message?: string
}

export interface ConfigUnpatchResult {
  changed: boolean
  removedVaultPaths: number
  message?: string
}

export interface HookRemoveResult {
  status: "removed" | "skipped" | "failed"
  message?: string
}

export interface MigrateConcurrencyPatchResult {
  changed: boolean
  cronMaxConcurrentRuns?: number
  agentMaxConcurrent?: number
  message?: string
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value)
    return normalized > 0 ? normalized : undefined
  }

  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    const parsed = Number(value.trim())
    const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : 0
    return normalized > 0 ? normalized : undefined
  }

  return undefined
}

function normalizePathForComparison(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/\/+$/u, "")
}

function removeExtraPathValue(container: JsonRecord, targetPath: string): number {
  if (!Array.isArray(container.extraPaths)) {
    return 0
  }

  const normalizedTarget = normalizePathForComparison(targetPath)
  let removedCount = 0
  const filtered = container.extraPaths.filter((entry) => {
    if (typeof entry !== "string") {
      return true
    }

    if (normalizePathForComparison(entry) !== normalizedTarget) {
      return true
    }

    removedCount += 1
    return false
  })

  if (removedCount > 0) {
    container.extraPaths = filtered
  }

  return removedCount
}

export async function patchOpenClawConfig(vaultPath: string, openclawDir: string): Promise<ConfigPatchResult> {
  const configPath = join(openclawDir, "openclaw.json")

  try {
    const raw = await readFile(configPath, "utf8")
    const config = asRecord(JSON.parse(raw))
    let changed = false

    const legacyMemorySearch = asRecord(config.memorySearch)
    const legacyExtraPaths = Array.isArray(legacyMemorySearch.extraPaths) ? [...legacyMemorySearch.extraPaths] : []

    const agents = asRecord(config.agents)
    config.agents = agents
    const defaults = asRecord(agents.defaults)
    agents.defaults = defaults
    const memorySearch = asRecord(defaults.memorySearch)
    defaults.memorySearch = memorySearch

    const extraPaths = Array.isArray(memorySearch.extraPaths) ? [...memorySearch.extraPaths] : []
    memorySearch.extraPaths = extraPaths

    for (const candidate of legacyExtraPaths) {
      if (typeof candidate !== "string") {
        continue
      }

      if (!extraPaths.includes(candidate)) {
        extraPaths.push(candidate)
        changed = true
      }
    }

    if (!extraPaths.includes(vaultPath)) {
      extraPaths.push(vaultPath)
      changed = true
    }

    if ("memorySearch" in config) {
      // Preserve object shape for lint and rely on JSON.stringify omitting undefined keys.
      config.memorySearch = undefined
      changed = true
    }

    const hooks = asRecord(config.hooks)
    config.hooks = hooks

    const internal = asRecord(hooks.internal)
    hooks.internal = internal

    if (internal.enabled !== true) {
      internal.enabled = true
      changed = true
    }

    const entries = asRecord(internal.entries)
    internal.entries = entries

    const zettelclawEntry = coerceHookEntry(entries.zettelclaw)
    entries.zettelclaw = zettelclawEntry
    if (zettelclawEntry.enabled !== true) {
      zettelclawEntry.enabled = true
      changed = true
    }

    const sessionMemoryEntry = coerceHookEntry(entries["session-memory"])
    entries["session-memory"] = sessionMemoryEntry
    if (sessionMemoryEntry.enabled !== false) {
      sessionMemoryEntry.enabled = false
      changed = true
    }

    if (!changed) {
      return { changed: false }
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
    return { changed: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { changed: false, message: `Could not patch ${configPath}: ${message}` }
  }
}

export async function unpatchOpenClawConfig(vaultPath: string | undefined, openclawDir: string): Promise<ConfigUnpatchResult> {
  const configPath = join(openclawDir, "openclaw.json")

  try {
    const raw = await readFile(configPath, "utf8")
    const config = asRecord(JSON.parse(raw))
    let changed = false
    let removedVaultPaths = 0

    const hooks = asRecord(config.hooks)
    config.hooks = hooks
    const internal = asRecord(hooks.internal)
    hooks.internal = internal
    const entries = asRecord(internal.entries)
    internal.entries = entries

    const zettelclawEntry = coerceHookEntry(entries.zettelclaw)
    entries.zettelclaw = zettelclawEntry
    if (zettelclawEntry.enabled !== false) {
      zettelclawEntry.enabled = false
      changed = true
    }

    const sessionMemoryEntry = coerceHookEntry(entries["session-memory"])
    entries["session-memory"] = sessionMemoryEntry
    if (sessionMemoryEntry.enabled !== true) {
      sessionMemoryEntry.enabled = true
      changed = true
    }

    if (typeof vaultPath === "string" && vaultPath.trim().length > 0) {
      const normalizedVaultPath = vaultPath.trim()

      const legacyMemorySearch = asRecord(config.memorySearch)
      const removedFromLegacy = removeExtraPathValue(legacyMemorySearch, normalizedVaultPath)
      if (removedFromLegacy > 0) {
        config.memorySearch = legacyMemorySearch
        removedVaultPaths += removedFromLegacy
        changed = true
      }

      const agents = asRecord(config.agents)
      config.agents = agents
      const defaults = asRecord(agents.defaults)
      agents.defaults = defaults
      const defaultsMemorySearch = asRecord(defaults.memorySearch)
      defaults.memorySearch = defaultsMemorySearch

      const removedFromDefaults = removeExtraPathValue(defaultsMemorySearch, normalizedVaultPath)
      if (removedFromDefaults > 0) {
        removedVaultPaths += removedFromDefaults
        changed = true
      }
    }

    if (changed) {
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
    }

    return {
      changed,
      removedVaultPaths,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      changed: false,
      removedVaultPaths: 0,
      message: `Could not unpatch ${configPath}: ${message}`,
    }
  }
}

export async function uninstallOpenClawHook(openclawDir: string): Promise<HookRemoveResult> {
  const hookPath = join(openclawDir, "hooks", "zettelclaw")

  try {
    if (!(await pathExists(hookPath))) {
      return { status: "skipped" }
    }

    await rm(hookPath, { recursive: true, force: true })
    return { status: "removed" }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: "failed", message: `Could not remove hook at ${hookPath}: ${message}` }
  }
}

export async function ensureMigrateConcurrencyConfig(
  openclawDir: string,
  minimumConcurrent: number,
): Promise<MigrateConcurrencyPatchResult> {
  const configPath = join(openclawDir, "openclaw.json")
  const normalizedMinimum = Number.isFinite(minimumConcurrent) ? Math.max(1, Math.floor(minimumConcurrent)) : 1

  try {
    const raw = await readFile(configPath, "utf8")
    const config = asRecord(JSON.parse(raw))
    let changed = false

    const cron = asRecord(config.cron)
    config.cron = cron
    const agents = asRecord(config.agents)
    config.agents = agents
    const defaults = asRecord(agents.defaults)
    agents.defaults = defaults

    const currentCronMaxConcurrentRuns = readPositiveInteger(cron.maxConcurrentRuns)
    const currentAgentMaxConcurrent = readPositiveInteger(defaults.maxConcurrent)

    const targetCronMaxConcurrentRuns = Math.max(currentCronMaxConcurrentRuns ?? 0, normalizedMinimum)
    const targetAgentMaxConcurrent = Math.max(currentAgentMaxConcurrent ?? 0, normalizedMinimum)

    if (currentCronMaxConcurrentRuns !== targetCronMaxConcurrentRuns || typeof cron.maxConcurrentRuns !== "number") {
      cron.maxConcurrentRuns = targetCronMaxConcurrentRuns
      changed = true
    }

    if (currentAgentMaxConcurrent !== targetAgentMaxConcurrent || typeof defaults.maxConcurrent !== "number") {
      defaults.maxConcurrent = targetAgentMaxConcurrent
      changed = true
    }

    if (changed) {
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
    }

    return {
      changed,
      cronMaxConcurrentRuns: targetCronMaxConcurrentRuns,
      agentMaxConcurrent: targetAgentMaxConcurrent,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      changed: false,
      message: `Could not configure migrate concurrency in ${configPath}: ${message}`,
    }
  }
}

function sweepCronJobMatchesDesiredSchedule(job: JsonRecord, expectedTimeZone: string): boolean {
  const expression = readCronJobExpression(job)
  const timeZone = readCronJobTimeZone(job)
  const session = readCronJobSession(job)
  const message = readCronJobMessage(job)

  return (
    expression === SWEEP_CRON_EXPRESSION &&
    timeZone === expectedTimeZone &&
    session === SWEEP_CRON_SESSION &&
    message === SWEEP_CRON_MESSAGE
  )
}

function nightlyMaintenanceCronJobMatchesDesiredSchedule(
  job: JsonRecord,
  expectedTimeZone: string,
  expectedMessage: string,
): boolean {
  const expression = readCronJobExpression(job)
  const timeZone = readCronJobTimeZone(job)
  const session = readCronJobSession(job)
  const message = readCronJobMessage(job)

  return (
    expression === NIGHTLY_MAINTENANCE_CRON_EXPRESSION &&
    timeZone === expectedTimeZone &&
    session === NIGHTLY_MAINTENANCE_CRON_SESSION &&
    message === expectedMessage
  )
}

function resolveLocalTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (typeof timeZone === "string" && timeZone.trim().length > 0) {
    return timeZone.trim()
  }

  return "UTC"
}

function runCronCommand(args: string[]): { ok: boolean; stdout: string; stderr: string; message?: string } {
  const result = runOpenClawCommand(args, { timeoutMs: 15_000 })
  const output: { ok: boolean; stdout: string; stderr: string; message?: string } = {
    ok: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
  }
  if (typeof result.message === "string") {
    output.message = result.message
  }

  return output
}

export interface CronJobResult {
  status: "installed" | "skipped" | "failed"
  message?: string
}

function ensureCronJob(
  jobName: string,
  matchesDesiredSchedule: (job: JsonRecord) => boolean,
  createCommandArgs: string[],
): CronJobResult {
  const listed = runCronCommand(["cron", "list", "--json"])

  if (!listed.ok) {
    return { status: "failed", message: `Could not list cron jobs: ${listed.message ?? "unknown error"}` }
  }

  const parsedJobs = parseCronJobs(listed.stdout)
  if (parsedJobs.error) {
    return { status: "failed", message: `Could not parse cron jobs JSON: ${parsedJobs.error}` }
  }

  const jobs = parsedJobs.jobs
  const namedJobs = jobs.filter((job) => job.name === jobName)
  const enabledJob = namedJobs.find((job) => isCronJobEnabled(job))

  if (enabledJob) {
    if (matchesDesiredSchedule(enabledJob)) {
      return { status: "skipped" }
    }

    const enabledJobId = readCronJobId(enabledJob)
    if (!enabledJobId) {
      return {
        status: "failed",
        message: `Found legacy ${jobName} cron job without an id; disable it manually and rerun init.`,
      }
    }

    const disabled = runCronCommand(["cron", "disable", enabledJobId])
    if (!disabled.ok) {
      return {
        status: "failed",
        message: `Could not disable legacy ${jobName}: ${disabled.message ?? "unknown error"}`,
      }
    }
  }

  const matchingDisabledJobWithId = namedJobs.find(
    (job) => !isCronJobEnabled(job) && matchesDesiredSchedule(job) && readCronJobId(job),
  )

  if (matchingDisabledJobWithId) {
    const jobId = readCronJobId(matchingDisabledJobWithId) as string
    const enabled = runCronCommand(["cron", "enable", jobId])

    if (!enabled.ok) {
      return {
        status: "failed",
        message: `Could not enable ${jobName}: ${enabled.message ?? "unknown error"}`,
      }
    }

    return { status: "installed" }
  }

  const created = runCronCommand(createCommandArgs)

  if (!created.ok) {
    return {
      status: "failed",
      message: `Could not create ${jobName}: ${created.message ?? "unknown error"}`,
    }
  }

  return { status: "installed" }
}

export function ensureZettelclawSweepCronJob(): CronJobResult {
  const timeZone = resolveLocalTimeZone()
  return ensureCronJob(SWEEP_CRON_JOB_NAME, (job) => sweepCronJobMatchesDesiredSchedule(job, timeZone), [
    "cron",
    "add",
    "--name",
    SWEEP_CRON_JOB_NAME,
    "--description",
    "Daily Zettelclaw transcript sweep trigger",
    "--cron",
    SWEEP_CRON_EXPRESSION,
    "--tz",
    timeZone,
    "--exact",
    "--session",
    SWEEP_CRON_SESSION,
    "--message",
    SWEEP_CRON_MESSAGE,
    "--no-deliver",
    "--json",
  ])
}

export async function ensureZettelclawNightlyMaintenanceCronJob(vaultPath: string): Promise<CronJobResult> {
  const templatePath = join(TEMPLATE_SOURCE_DIR, NIGHTLY_MAINTENANCE_TEMPLATE)
  let template: string

  try {
    template = await readFile(templatePath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: "failed", message: `Could not read template ${templatePath}: ${message}` }
  }

  const maintenanceMessage = substituteTemplate(template, {
    VAULT_PATH: vaultPath,
    SKILL_PACKAGE_PATH: resolveSkillPackageDir(),
  }).trim()

  if (maintenanceMessage.length === 0) {
    return { status: "failed", message: `Template ${templatePath} rendered an empty maintenance message.` }
  }

  const timeZone = resolveLocalTimeZone()
  return ensureCronJob(
    NIGHTLY_MAINTENANCE_CRON_JOB_NAME,
    (job) => nightlyMaintenanceCronJobMatchesDesiredSchedule(job, timeZone, maintenanceMessage),
    [
      "cron",
      "add",
      "--name",
      NIGHTLY_MAINTENANCE_CRON_JOB_NAME,
      "--description",
      "Nightly Zettelclaw vault maintenance pass",
      "--cron",
      NIGHTLY_MAINTENANCE_CRON_EXPRESSION,
      "--tz",
      timeZone,
      "--exact",
      "--session",
      NIGHTLY_MAINTENANCE_CRON_SESSION,
      "--message",
      maintenanceMessage,
      "--timeout-seconds",
      NIGHTLY_MAINTENANCE_CRON_TIMEOUT_SECONDS,
      "--no-deliver",
      "--json",
    ],
  )
}

/**
 * Fire a system event to tell the running OpenClaw agent to update
 * AGENTS.md with Zettelclaw-aware memory content.
 *
 * Uses `openclaw system event` CLI. Returns true if the event was sent.
 */
export interface EventFireResult {
  sent: boolean
  message?: string
}

export async function firePostInitEvent(vaultPath: string): Promise<EventFireResult> {
  const templatePath = join(TEMPLATE_SOURCE_DIR, "post-init-event.md")
  let template: string
  try {
    template = await readFile(templatePath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { sent: false, message: `Could not read template ${templatePath}: ${message}` }
  }

  const eventText = substituteTemplate(template, {
    VAULT_PATH: vaultPath,
    SKILL_PACKAGE_PATH: resolveSkillPackageDir(),
  })

  const direct = runOpenClawCommand(["system", "event", "--text", eventText, "--mode", "now"], {
    timeoutMs: 10_000,
  })
  if (direct.ok) {
    return { sent: true }
  }

  const fallback = runOpenClawCommand(["system", "event", "--text", eventText], {
    timeoutMs: 10_000,
  })
  if (fallback.ok) {
    return { sent: true }
  }

  return {
    sent: false,
    message: `Could not fire post-init event via OpenClaw CLI: ${fallback.message ?? direct.message ?? "unknown error"}`,
  }
}
