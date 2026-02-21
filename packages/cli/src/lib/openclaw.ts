import { spawnSync } from "node:child_process"
import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { asRecord, type JsonRecord } from "./json"
import { resolveSkillPackageDir, resolveSkillPath } from "./skill"
import { substituteTemplate } from "./template"
import { pathExists } from "./vault"

const HOOK_SOURCE_DIR = resolveSkillPath("hooks", "zettelclaw")
const TEMPLATE_SOURCE_DIR = resolveSkillPath("templates")
const SWEEP_CRON_JOB_NAME = "zettelclaw-sweep"
const SWEEP_CRON_EXPRESSION = "0 2 * * *"
const SWEEP_CRON_SESSION = "isolated"
const SWEEP_CRON_MESSAGE = "/reset"
const NIGHTLY_MAINTENANCE_CRON_JOB_NAME = "zettelclaw-nightly-maintenance"
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

export async function installOpenClawHook(openclawDir: string): Promise<HookInstallResult> {
  const hookPath = join(openclawDir, "hooks", "zettelclaw")

  try {
    if (await pathExists(hookPath)) {
      return { status: "skipped" }
    }

    if (!(await pathExists(HOOK_SOURCE_DIR))) {
      return { status: "failed", message: `Missing bundled hook at ${HOOK_SOURCE_DIR}` }
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

export async function patchOpenClawConfig(vaultPath: string, openclawDir: string): Promise<ConfigPatchResult> {
  const configPath = join(openclawDir, "openclaw.json")

  try {
    const raw = await readFile(configPath, "utf8")
    const config = asRecord(JSON.parse(raw))
    let changed = false

    const agents = asRecord(config.agents)
    config.agents = agents
    const defaults = asRecord(agents.defaults)
    agents.defaults = defaults
    const memorySearch = asRecord(defaults.memorySearch)
    defaults.memorySearch = memorySearch

    const extraPaths = Array.isArray(memorySearch.extraPaths) ? [...memorySearch.extraPaths] : []
    memorySearch.extraPaths = extraPaths

    if (!extraPaths.includes(vaultPath)) {
      extraPaths.push(vaultPath)
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

function parseCronJobs(raw: string): JsonRecord[] {
  try {
    const parsed = asRecord(JSON.parse(raw))
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : []
    return jobs.map((entry) => asRecord(entry))
  } catch {
    return []
  }
}

function readCronJobText(job: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = job[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }

  return undefined
}

function isCronJobEnabled(job: JsonRecord): boolean {
  return job.enabled === true || job.enabled === "true"
}

function readCronJobExpression(job: JsonRecord): string | undefined {
  const direct = readCronJobText(job, ["cron", "schedule"])
  if (direct) {
    return direct
  }

  const schedule = asRecord(job.schedule)
  return readCronJobText(schedule, ["expr", "cron"])
}

function readCronJobTimeZone(job: JsonRecord): string | undefined {
  const direct = readCronJobText(job, ["tz", "timezone"])
  if (direct) {
    return direct
  }

  const schedule = asRecord(job.schedule)
  return readCronJobText(schedule, ["tz", "timezone"])
}

function readCronJobSession(job: JsonRecord): string | undefined {
  const direct = readCronJobText(job, ["session", "sessionKey", "sessionTarget"])
  if (direct) {
    return direct
  }

  const payload = asRecord(job.payload)
  return readCronJobText(payload, ["session", "sessionKey", "sessionTarget"])
}

function readCronJobMessage(job: JsonRecord): string | undefined {
  const direct = readCronJobText(job, ["message"])
  if (direct) {
    return direct
  }

  const payload = asRecord(job.payload)
  return readCronJobText(payload, ["message"])
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

function getCronJobId(job: JsonRecord): string | undefined {
  const id = job.id
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : undefined
}

function runCronCommand(args: string[]): { ok: boolean; stdout: string; stderr: string; message?: string } {
  const result = spawnSync("openclaw", args, {
    encoding: "utf8",
    timeout: 15_000,
  })

  if (result.error) {
    return {
      ok: false,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      message: result.error.message,
    }
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim()
    return {
      ok: false,
      stdout: result.stdout ?? "",
      stderr,
      message: stderr.length > 0 ? stderr : `openclaw ${args.join(" ")} exited with code ${result.status}`,
    }
  }

  return {
    ok: true,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
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

  const jobs = parseCronJobs(listed.stdout)
  const namedJobs = jobs.filter((job) => job.name === jobName)
  const enabledJob = namedJobs.find((job) => isCronJobEnabled(job))

  if (enabledJob) {
    if (matchesDesiredSchedule(enabledJob)) {
      return { status: "skipped" }
    }

    const enabledJobId = getCronJobId(enabledJob)
    if (!enabledJobId) {
      return {
        status: "failed",
        message: `Found legacy ${jobName} cron job without an id; disable it manually and rerun init.`,
      }
    }

    const disabled = runCronCommand(["cron", "disable", enabledJobId, "--json"])
    if (!disabled.ok) {
      return {
        status: "failed",
        message: `Could not disable legacy ${jobName}: ${disabled.message ?? "unknown error"}`,
      }
    }
  }

  const matchingDisabledJobWithId = namedJobs.find(
    (job) => !isCronJobEnabled(job) && matchesDesiredSchedule(job) && getCronJobId(job),
  )

  if (matchingDisabledJobWithId) {
    const jobId = getCronJobId(matchingDisabledJobWithId) as string
    const enabled = runCronCommand(["cron", "enable", jobId, "--json"])

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
 * AGENTS.md and HEARTBEAT.md with Zettelclaw-aware content.
 *
 * Uses `openclaw system event` CLI. Returns true if the event was sent.
 */
export interface EventFireResult {
  sent: boolean
  message?: string
}

export async function firePostInitEvent(vaultPath: string): Promise<EventFireResult> {
  // Read the post-init event template
  const templatePath = join(TEMPLATE_SOURCE_DIR, "post-init-event.md")
  let template: string
  try {
    template = await readFile(templatePath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { sent: false, message: `Could not read template ${templatePath}: ${message}` }
  }

  // Substitute variables
  const eventText = substituteTemplate(template, {
    VAULT_PATH: vaultPath,
    SKILL_PACKAGE_PATH: resolveSkillPackageDir(),
  })

  // Fire the system event via OpenClaw CLI
  const result = spawnSync("openclaw", ["system", "event", "--text", eventText, "--mode", "now"], {
    encoding: "utf8",
    timeout: 10_000,
  })

  if (result.error || result.status !== 0) {
    // Try the cron wake approach as fallback
    const fallback = spawnSync("openclaw", ["system", "event", "--text", eventText], {
      encoding: "utf8",
      timeout: 10_000,
    })

    if (fallback.error || fallback.status !== 0) {
      const errorMessage =
        fallback.error?.message ??
        fallback.stderr?.trim() ??
        result.error?.message ??
        result.stderr?.trim() ??
        "unknown error"
      return { sent: false, message: `Could not fire post-init event via OpenClaw CLI: ${errorMessage}` }
    }
  }

  return { sent: true }
}
