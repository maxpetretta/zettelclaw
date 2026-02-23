import { dirname } from "node:path"
import { confirm, intro, log, spinner } from "@clack/prompts"

import { DEFAULT_OPENCLAW_WORKSPACE_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import { JOURNAL_FOLDER_ALIASES, NOTES_FOLDER_CANDIDATES } from "../lib/folders"
import { removeCronJobsByName } from "../lib/openclaw-jobs"
import { runOpenClawCommand } from "../lib/openclaw-command"
import { configureOpenClawEnvForWorkspace } from "../lib/openclaw-workspace"
import { unpatchOpenClawConfig, uninstallOpenClawHook } from "../lib/openclaw"
import { resolveUserPath } from "../lib/paths"
import { detectVaultFromOpenClawConfig } from "../lib/vault-detect"
import { isDirectory } from "../lib/vault-fs"
import { removeAgentSymlinks } from "../lib/vault-agent"

const JOURNAL_FOLDER_CANDIDATES = [...JOURNAL_FOLDER_ALIASES]
const ZETTELCLAW_CRON_NAMES = [
  "zettelclaw-reset",
  "zettelclaw-nightly",
  "zettelclaw-migrate-subagent",
  "zettelclaw-migrate-synthesis",
] as const

export interface UninstallOptions {
  yes: boolean
  vaultPath?: string | undefined
  workspacePath?: string | undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForGatewayHealthy(maxWaitMs = 60_000, pollIntervalMs = 2_000): Promise<string | null> {
  const deadline = Date.now() + maxWaitMs
  let lastError = "Gateway did not report a healthy state."

  while (Date.now() < deadline) {
    const health = runOpenClawCommand(["gateway", "health", "--json", "--timeout", "5000"], { timeoutMs: 10_000 })

    if (health.ok) {
      try {
        const parsed = JSON.parse(health.stdout) as Record<string, unknown>
        if (parsed.ok === true) {
          return null
        }

        const reason = typeof parsed.message === "string" ? parsed.message.trim() : ""
        lastError = reason.length > 0 ? reason : "Gateway health check returned ok=false."
      } catch {
        const trimmed = health.stdout.trim()
        lastError =
          trimmed.length > 0 ? `Could not parse gateway health JSON: ${trimmed}` : "Malformed gateway health JSON."
      }
    } else {
      lastError = health.message ?? "Gateway health check failed."
    }

    await sleep(pollIntervalMs)
  }

  return `Gateway restart timed out after ${Math.round(maxWaitMs / 1000)}s. Last check: ${lastError}`
}

async function restartGatewayAndWait(): Promise<string | null> {
  const restart = runOpenClawCommand(["gateway", "restart", "--json"], { timeoutMs: 20_000 })
  if (!restart.ok) {
    return `Could not restart OpenClaw gateway: ${restart.message ?? "unknown error"}`
  }

  return await waitForGatewayHealthy()
}

async function resolveVaultPath(options: UninstallOptions, openclawConfigPath: string): Promise<string | undefined> {
  if (options.vaultPath) {
    return resolveUserPath(options.vaultPath)
  }

  return await detectVaultFromOpenClawConfig(openclawConfigPath, NOTES_FOLDER_CANDIDATES, JOURNAL_FOLDER_CANDIDATES)
}

export async function runUninstall(options: UninstallOptions): Promise<void> {
  intro("🦞 Zettelclaw - Uninstall integration")

  const workspacePath = resolveUserPath(options.workspacePath ?? DEFAULT_OPENCLAW_WORKSPACE_PATH)
  const openclawEnv = configureOpenClawEnvForWorkspace(workspacePath)
  const openclawDir = dirname(workspacePath)

  if (!(await isDirectory(openclawDir))) {
    throw new Error(`OpenClaw profile directory not found at ${toTildePath(openclawDir)}`)
  }

  const vaultPath = await resolveVaultPath(options, openclawEnv.configPath)
  if (options.vaultPath && !(await isDirectory(resolveUserPath(options.vaultPath)))) {
    throw new Error(`Vault path not found: ${toTildePath(resolveUserPath(options.vaultPath))}`)
  }

  const plannedChanges: string[] = [
    "Disable hook flags (zettelclaw=false, session-memory=true).",
    "Remove Zettelclaw cron jobs (reset/nightly/migrate).",
    "Remove OpenClaw hook folder ~/.openclaw/hooks/zettelclaw.",
  ]
  if (vaultPath) {
    plannedChanges.push(`Remove managed agent symlinks in ${toTildePath(vaultPath)}.`)
    plannedChanges.push(`Remove ${toTildePath(vaultPath)} from OpenClaw memory paths.`)
  } else {
    plannedChanges.push("Skip vault-specific cleanup (no vault path detected).")
  }

  log.message(
    [
      `Workspace: ${toTildePath(workspacePath)}`,
      `OpenClaw config: ${toTildePath(openclawEnv.configPath)}`,
      `Vault: ${vaultPath ? toTildePath(vaultPath) : "not detected"}`,
      "",
      "Planned changes:",
      ...plannedChanges.map((line) => `- ${line}`),
    ].join("\n"),
  )

  const confirmed = options.yes
    ? true
    : unwrapPrompt(
        await confirm({
          message: "Proceed with uninstall?",
          initialValue: true,
        }),
      )
  if (!confirmed) {
    log.message("Uninstall canceled.")
    return
  }

  const failures: string[] = []
  const warnings: string[] = []
  let restartRequired = false

  const configSpinner = spinner()
  configSpinner.start("Reverting OpenClaw config")
  const configResult = await unpatchOpenClawConfig(vaultPath, openclawDir)
  if (configResult.message) {
    configSpinner.stop("OpenClaw config revert failed")
    failures.push(configResult.message)
  } else if (configResult.changed) {
    restartRequired = true
    configSpinner.stop(
      `OpenClaw config updated (removed ${configResult.removedVaultPaths} vault path entr${
        configResult.removedVaultPaths === 1 ? "y" : "ies"
      })`,
    )
  } else {
    configSpinner.stop("OpenClaw config already clean")
  }

  const cronSpinner = spinner()
  cronSpinner.start("Removing Zettelclaw cron jobs")
  try {
    const cronCleanup = await removeCronJobsByName(ZETTELCLAW_CRON_NAMES)
    cronSpinner.stop(
      `Removed ${cronCleanup.removedJobs}/${cronCleanup.matchedJobs} matching cron jobs (scanned ${cronCleanup.scannedJobs})`,
    )
    if (cronCleanup.failedJobIds.length > 0) {
      warnings.push(
        `Could not remove ${cronCleanup.failedJobIds.length} cron job(s): ${cronCleanup.failedJobIds.join(", ")}`,
      )
    }
  } catch (error) {
    cronSpinner.stop("Cron cleanup failed")
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`Could not remove Zettelclaw cron jobs: ${message}`)
  }

  const hookSpinner = spinner()
  hookSpinner.start("Removing OpenClaw hook")
  const hookResult = await uninstallOpenClawHook(openclawDir)
  if (hookResult.status === "failed") {
    hookSpinner.stop("Hook removal failed")
    failures.push(hookResult.message ?? "Could not remove OpenClaw hook.")
  } else if (hookResult.status === "removed") {
    restartRequired = true
    hookSpinner.stop("OpenClaw hook removed")
  } else {
    hookSpinner.stop("OpenClaw hook already absent")
  }

  if (vaultPath) {
    const symlinkSpinner = spinner()
    symlinkSpinner.start("Removing managed agent symlinks from vault")
    const symlinkResult = await removeAgentSymlinks(vaultPath, workspacePath)
    symlinkSpinner.stop(
      `Agent symlink cleanup: removed=${symlinkResult.removed.length}, skipped=${symlinkResult.skipped.length}, failed=${symlinkResult.failed.length}`,
    )
    if (symlinkResult.failed.length > 0) {
      failures.push(`Could not remove ${symlinkResult.failed.length} agent symlink(s): ${symlinkResult.failed.join(", ")}`)
    }
  } else {
    warnings.push("Skipped vault symlink cleanup because no vault path was detected. Re-run with --vault to target one.")
  }

  if (restartRequired) {
    const restartSpinner = spinner()
    restartSpinner.start("Restarting OpenClaw gateway")
    const restartError = await restartGatewayAndWait()
    if (restartError) {
      restartSpinner.stop("Gateway restart check failed")
      warnings.push(restartError)
    } else {
      restartSpinner.stop("OpenClaw gateway restarted")
    }
  }

  for (const warning of warnings) {
    log.warn(warning)
  }

  if (failures.length > 0) {
    throw new Error(`Uninstall encountered errors:\n${failures.map((entry) => `- ${entry}`).join("\n")}`)
  }

  log.success("Zettelclaw OpenClaw integration was removed.")
  log.message("Note: existing AGENTS.md/MEMORY.md content is not automatically reverted.")
}
