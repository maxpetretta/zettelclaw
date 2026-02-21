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
const SWEEP_CRON_INTERVAL = "30m"
const SWEEP_CRON_SESSION = "isolated"
const SWEEP_CRON_MESSAGE = "/reset"

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

export interface SweepCronResult {
  status: "installed" | "skipped" | "failed"
  message?: string
}

export function ensureZettelclawSweepCronJob(): SweepCronResult {
  const listed = runCronCommand(["cron", "list", "--json"])

  if (!listed.ok) {
    return { status: "failed", message: `Could not list cron jobs: ${listed.message ?? "unknown error"}` }
  }

  const jobs = parseCronJobs(listed.stdout)
  const namedJobs = jobs.filter((job) => job.name === SWEEP_CRON_JOB_NAME)
  const enabledJob = namedJobs.find((job) => job.enabled === true)

  if (enabledJob) {
    return { status: "skipped" }
  }

  const disabledJobWithId = namedJobs.find((job) => typeof job.id === "string" && (job.id as string).length > 0)

  if (disabledJobWithId) {
    const jobId = disabledJobWithId.id as string
    const enabled = runCronCommand(["cron", "enable", jobId, "--json"])

    if (!enabled.ok) {
      return {
        status: "failed",
        message: `Could not enable ${SWEEP_CRON_JOB_NAME}: ${enabled.message ?? "unknown error"}`,
      }
    }

    return { status: "installed" }
  }

  const created = runCronCommand([
    "cron",
    "add",
    "--name",
    SWEEP_CRON_JOB_NAME,
    "--description",
    "Periodic Zettelclaw transcript sweep trigger",
    "--every",
    SWEEP_CRON_INTERVAL,
    "--session",
    SWEEP_CRON_SESSION,
    "--message",
    SWEEP_CRON_MESSAGE,
    "--no-deliver",
    "--json",
  ])

  if (!created.ok) {
    return {
      status: "failed",
      message: `Could not create ${SWEEP_CRON_JOB_NAME}: ${created.message ?? "unknown error"}`,
    }
  }

  return { status: "installed" }
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
