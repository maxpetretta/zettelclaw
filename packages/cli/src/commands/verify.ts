import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { intro, log, text } from "@clack/prompts"

import { DEFAULT_OPENCLAW_WORKSPACE_PATH, DEFAULT_VAULT_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import { JOURNAL_FOLDER_ALIASES, NOTES_FOLDER_CANDIDATES } from "../lib/folders"
import { asRecord } from "../lib/json"
import { runOpenClawCommand } from "../lib/openclaw-command"
import { readHookEnabled, readOpenClawConfigFile, readOpenClawExtraPathsByScope } from "../lib/openclaw-config"
import { type CronJobSnapshot, parseCronJobs, toCronJobSnapshots } from "../lib/openclaw-cron"
import { configureOpenClawEnvForWorkspace } from "../lib/openclaw-workspace"
import { resolveUserPath } from "../lib/paths"
import { resolveSkillPackageDir } from "../lib/skill"
import { detectVaultFromOpenClawConfig, looksLikeZettelclawVault } from "../lib/vault-detect"
import { isDirectory, pathExists } from "../lib/vault-fs"

const JOURNAL_FOLDER_CANDIDATES = [...JOURNAL_FOLDER_ALIASES]

const RESET_CRON_NAME = "zettelclaw-reset"
const NIGHTLY_CRON_NAME = "zettelclaw-nightly"
const RESET_CRON_EXPR = "0 2 * * *"
const NIGHTLY_CRON_EXPR = "0 3 * * *"
const EXPECTED_CRON_SESSION = "isolated"

export interface VerifyOptions {
  yes: boolean
  vaultPath?: string | undefined
  workspacePath?: string | undefined
}

type CheckStatus = "pass" | "warn" | "fail"

interface VerifyCheck {
  name: string
  status: CheckStatus
  detail: string
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

async function detectVaultPath(options: VerifyOptions, workspacePath: string): Promise<string | undefined> {
  if (options.vaultPath) {
    return resolveUserPath(options.vaultPath)
  }

  const openclawConfigPath = join(dirname(workspacePath), "openclaw.json")
  const detected = await detectVaultFromOpenClawConfig(
    openclawConfigPath,
    NOTES_FOLDER_CANDIDATES,
    JOURNAL_FOLDER_CANDIDATES,
  )
  if (detected) {
    return detected
  }

  if (options.yes) {
    return undefined
  }

  return resolveUserPath(await promptVaultPath())
}

async function readFileText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return undefined
  }
}

function normalizePath(path: string): string {
  return resolveUserPath(path).replace(/[/\\]+$/u, "")
}

function pathListIncludes(paths: readonly string[], targetPath: string): boolean {
  const target = normalizePath(targetPath)
  return paths.some((value) => normalizePath(value) === target)
}

function listCronJobs(): { jobs: CronJobSnapshot[]; error?: string } {
  const result = runOpenClawCommand(["cron", "list", "--json"], { timeoutMs: 15_000 })
  if (!result.ok) {
    return { jobs: [], error: result.message ?? "Could not list cron jobs." }
  }

  const parsed = parseCronJobs(result.stdout)
  if (parsed.error) {
    return { jobs: [], error: "Could not parse `openclaw cron list --json` output." }
  }

  return { jobs: toCronJobSnapshots(parsed.jobs) }
}

function buildCronCheck(
  jobs: readonly CronJobSnapshot[],
  options: { name: string; expression: string; session: string; messageIncludes?: string[] },
): VerifyCheck {
  const namedJobs = jobs.filter((job) => job.name === options.name)
  const enabledJob = namedJobs.find((job) => job.enabled)

  if (!enabledJob) {
    const hasDisabled = namedJobs.length > 0
    return {
      name: `${options.name} cron`,
      status: "fail",
      detail: hasDisabled ? "present but disabled" : "missing",
    }
  }

  if (enabledJob.expression !== options.expression) {
    return {
      name: `${options.name} cron`,
      status: "fail",
      detail: `expected schedule ${options.expression}, found ${enabledJob.expression ?? "unknown"}`,
    }
  }

  if (enabledJob.session !== options.session) {
    return {
      name: `${options.name} cron`,
      status: "fail",
      detail: `expected session ${options.session}, found ${enabledJob.session ?? "unknown"}`,
    }
  }

  const requiredMessageSubstrings = options.messageIncludes ?? []
  for (const snippet of requiredMessageSubstrings) {
    if (!(enabledJob.message ?? "").includes(snippet)) {
      return {
        name: `${options.name} cron`,
        status: "fail",
        detail: `message does not include ${snippet}`,
      }
    }
  }

  return {
    name: `${options.name} cron`,
    status: "pass",
    detail: `enabled (${enabledJob.expression}, ${enabledJob.session})`,
  }
}

function formatCheck(check: VerifyCheck): string {
  const icon = check.status === "pass" ? "✅" : check.status === "fail" ? "❌" : "⚠️"
  return `${icon} ${check.name}: ${check.detail}`
}

async function buildAgentsCheck(agentsPath: string): Promise<VerifyCheck> {
  const contents = await readFileText(agentsPath)
  if (!contents) {
    return { name: "AGENTS.md memory guidance", status: "fail", detail: `missing ${toTildePath(agentsPath)}` }
  }

  const requiredMarkers = ["## Memory", "Layer 1 - Hook -> Journal", "Layer 3 - Nightly Cron -> Maintenance"]
  const matches = requiredMarkers.filter((marker) => contents.includes(marker)).length

  if (matches === requiredMarkers.length) {
    return { name: "AGENTS.md memory guidance", status: "pass", detail: "zettelclaw memory section detected" }
  }

  if (matches > 0) {
    return {
      name: "AGENTS.md memory guidance",
      status: "warn",
      detail: `partially updated (${matches}/${requiredMarkers.length} markers found)`,
    }
  }

  return { name: "AGENTS.md memory guidance", status: "fail", detail: "zettelclaw memory section not detected" }
}

async function buildMemoryCheck(memoryPath: string, vaultPath: string): Promise<VerifyCheck> {
  const contents = await readFileText(memoryPath)
  if (!contents) {
    return { name: "MEMORY.md Zettelclaw reference", status: "fail", detail: `missing ${toTildePath(memoryPath)}` }
  }

  const hasZettelclaw = /zettelclaw/iu.test(contents)
  const hasVaultPath = contents.includes(vaultPath) || contents.includes(toTildePath(vaultPath))

  if (hasZettelclaw && hasVaultPath) {
    return { name: "MEMORY.md Zettelclaw reference", status: "pass", detail: "includes Zettelclaw and vault path" }
  }

  if (hasZettelclaw || hasVaultPath) {
    return {
      name: "MEMORY.md Zettelclaw reference",
      status: "warn",
      detail: "partial reference found (missing either keyword or vault path)",
    }
  }

  return { name: "MEMORY.md Zettelclaw reference", status: "fail", detail: "no Zettelclaw reference found" }
}

export async function runVerify(options: VerifyOptions): Promise<void> {
  intro("🦞 Verify Zettelclaw Setup")

  const checks: VerifyCheck[] = []

  const workspacePath = resolveUserPath(options.workspacePath ?? DEFAULT_OPENCLAW_WORKSPACE_PATH)
  const openclawDir = dirname(workspacePath)
  configureOpenClawEnvForWorkspace(workspacePath)
  const openclawConfigPath = join(openclawDir, "openclaw.json")

  if (!(await isDirectory(workspacePath))) {
    throw new Error(`OpenClaw workspace not found at ${toTildePath(workspacePath)}`)
  }

  const vaultPath = await detectVaultPath(options, workspacePath)
  if (!(vaultPath && (await isDirectory(vaultPath)))) {
    throw new Error("Could not find a Zettelclaw vault. Provide --vault or run `zettelclaw init` first.")
  }

  checks.push({ name: "OpenClaw workspace", status: "pass", detail: workspacePath })
  checks.push({ name: "OpenClaw config path", status: "pass", detail: openclawConfigPath })
  checks.push({ name: "Vault path", status: "pass", detail: vaultPath })

  if (await looksLikeZettelclawVault(vaultPath, NOTES_FOLDER_CANDIDATES, JOURNAL_FOLDER_CANDIDATES)) {
    checks.push({ name: "Vault structure", status: "pass", detail: "notes + journal folders detected" })
  } else {
    checks.push({ name: "Vault structure", status: "fail", detail: "notes/journal folders not detected" })
  }

  const hookPath = join(openclawDir, "hooks", "zettelclaw")
  if (await isDirectory(hookPath)) {
    checks.push({ name: "Hook files", status: "pass", detail: `found at ${toTildePath(hookPath)}` })
  } else {
    checks.push({ name: "Hook files", status: "fail", detail: `missing ${toTildePath(hookPath)}` })
  }

  const hookManifestPath = join(hookPath, "HOOK.md")
  const hookManifest = await readFileText(hookManifestPath)
  if (hookManifest?.includes("command:new") && hookManifest.includes("command:reset")) {
    checks.push({ name: "Hook event coverage", status: "pass", detail: "includes command:new + command:reset" })
  } else if (hookManifest) {
    checks.push({
      name: "Hook event coverage",
      status: "fail",
      detail: `missing command:new or command:reset in ${toTildePath(hookManifestPath)}`,
    })
  } else {
    checks.push({
      name: "Hook event coverage",
      status: "fail",
      detail: `could not read ${toTildePath(hookManifestPath)}`,
    })
  }

  const configReadResult = await readOpenClawConfigFile(openclawConfigPath)
  if (!configReadResult.config) {
    checks.push({
      name: "OpenClaw config",
      status: "fail",
      detail:
        typeof configReadResult.error === "string"
          ? configReadResult.error.replaceAll(openclawConfigPath, toTildePath(openclawConfigPath))
          : `could not read ${toTildePath(openclawConfigPath)}`,
    })
  } else {
    const config = configReadResult.config
    checks.push({ name: "OpenClaw config", status: "pass", detail: `read ${toTildePath(openclawConfigPath)}` })

    const hooks = asRecord(config.hooks)
    const internal = asRecord(hooks.internal)
    const entries = asRecord(internal.entries)

    const internalEnabled = readHookEnabled(internal)
    const zettelclawEnabled = readHookEnabled(entries.zettelclaw)
    const sessionMemoryEnabled = readHookEnabled(entries["session-memory"])

    if (internalEnabled === true && zettelclawEnabled === true && sessionMemoryEnabled === false) {
      checks.push({
        name: "Hook config flags",
        status: "pass",
        detail: "internal=true, zettelclaw=true, session-memory=false",
      })
    } else {
      checks.push({
        name: "Hook config flags",
        status: "fail",
        detail: `internal=${String(internalEnabled)}, zettelclaw=${String(zettelclawEnabled)}, session-memory=${String(sessionMemoryEnabled)}`,
      })
    }

    const extraPaths = readOpenClawExtraPathsByScope(config)
    const inGlobalPaths = pathListIncludes(extraPaths.global, vaultPath)
    const inDefaultPaths = pathListIncludes(extraPaths.defaults, vaultPath)
    const detail = `memorySearch.extraPaths=${inGlobalPaths ? "yes" : "no"}, agents.defaults.memorySearch.extraPaths=${inDefaultPaths ? "yes" : "no"}`

    if (inDefaultPaths) {
      checks.push({ name: "Vault in OpenClaw memory paths", status: "pass", detail })
    } else if (inGlobalPaths || inDefaultPaths) {
      checks.push({
        name: "Vault in OpenClaw memory paths",
        status: "warn",
        detail: `${detail} (legacy top-level path only; run init again to migrate)`,
      })
    } else {
      checks.push({ name: "Vault in OpenClaw memory paths", status: "fail", detail })
    }
  }

  const cronJobsResult = listCronJobs()
  if (cronJobsResult.error) {
    checks.push({ name: "Cron jobs", status: "fail", detail: cronJobsResult.error })
  } else {
    checks.push(
      buildCronCheck(cronJobsResult.jobs, {
        name: RESET_CRON_NAME,
        expression: RESET_CRON_EXPR,
        session: EXPECTED_CRON_SESSION,
        messageIncludes: ["/reset"],
      }),
    )
    checks.push(
      buildCronCheck(cronJobsResult.jobs, {
        name: NIGHTLY_CRON_NAME,
        expression: NIGHTLY_CRON_EXPR,
        session: EXPECTED_CRON_SESSION,
        messageIncludes: [vaultPath, "nightly maintenance"],
      }),
    )
  }

  let skillPath = ""
  try {
    skillPath = join(resolveSkillPackageDir(), "SKILL.md")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    checks.push({ name: "Zettelclaw skill", status: "fail", detail: message })
  }

  if (skillPath.length > 0) {
    if (await pathExists(skillPath)) {
      checks.push({ name: "Zettelclaw skill", status: "pass", detail: toTildePath(skillPath) })
    } else {
      checks.push({ name: "Zettelclaw skill", status: "fail", detail: `missing ${toTildePath(skillPath)}` })
    }
  }

  const agentsPath = join(workspacePath, "AGENTS.md")
  const memoryPath = join(workspacePath, "MEMORY.md")
  checks.push(await buildAgentsCheck(agentsPath))
  checks.push(await buildMemoryCheck(memoryPath, vaultPath))

  log.step("Verification status")
  for (const check of checks) {
    log.step(formatCheck(check))
  }

  const failCount = checks.filter((check) => check.status === "fail").length
  const warnCount = checks.filter((check) => check.status === "warn").length

  const hookFilesCheck = checks.find((check) => check.name === "Hook files")
  const hookConfigCheck = checks.find((check) => check.name === "Hook config flags")
  const memoryPathsCheck = checks.find((check) => check.name === "Vault in OpenClaw memory paths")
  const likelyDifferentProfile =
    hookFilesCheck?.status === "fail" && hookConfigCheck?.status === "fail" && memoryPathsCheck?.status === "fail"

  if (likelyDifferentProfile) {
    log.warn(
      "This profile does not look initialized for Zettelclaw yet. If you ran init in a clone, rerun init against this workspace/profile.",
    )
  }

  if (failCount > 0) {
    throw new Error(`Verification failed (${failCount} checks failed).`)
  }

  if (warnCount > 0) {
    log.warn(`Verification completed with ${warnCount} warning(s).`)
    return
  }

  log.success("Verification passed.")
}
