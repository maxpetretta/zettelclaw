import { spawn, spawnSync } from "node:child_process"
import { cp, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { confirm, intro, log, select, spinner, text } from "@clack/prompts"

import { chooseFileBackupPath } from "../lib/backups"
import { DEFAULT_OPENCLAW_WORKSPACE_PATH, DEFAULT_VAULT_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import {
  ensureZettelclawNightlyMaintenanceCronJob,
  ensureZettelclawSweepCronJob,
  firePostInitEvent,
  installOpenClawHook,
  patchOpenClawConfig,
} from "../lib/openclaw"
import { configureOpenClawEnvForWorkspace } from "../lib/openclaw-workspace"
import { resolveUserPath } from "../lib/paths"
import { type DownloadResult, downloadPlugins } from "../lib/plugins"
import { resolveSkillPath } from "../lib/skill"
import { configureAgentFolder, createAgentSymlinks } from "../lib/vault-agent"
import { isDirectory, pathExists } from "../lib/vault-fs"
import {
  configureApp,
  configureCommunityPlugins,
  configureCoreSync,
  configureMinimalTheme,
  type SyncMethod,
} from "../lib/vault-obsidian"
import { type CopyResult, copyVaultSeed, seedVaultStarterContent } from "../lib/vault-seed"

export interface InitOptions {
  yes: boolean
  vaultPath?: string | undefined
  minimal: boolean
  workspacePath?: string | undefined
}

type InstallStatus = "installed" | "skipped" | "failed"

interface IntegrationSummary {
  hookInstallStatus: InstallStatus | null
  sweepCronStatus: InstallStatus | null
  nightlyMaintenanceCronStatus: InstallStatus | null
  gatewayRestarted: boolean
}

function initGitRepository(vaultPath: string): string | null {
  const result = spawnSync("git", ["init"], {
    cwd: vaultPath,
    encoding: "utf8",
  })

  if (result.error) {
    return result.error.message
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim()
    if (stderr.length > 0) {
      return stderr
    }

    return `git init exited with code ${result.status}`
  }

  return null
}

function formatOpenClawFailure(args: string[], status: number, stderr: string, stdout: string): string {
  const trimmedStderr = stderr.trim()
  if (trimmedStderr.length > 0) {
    return trimmedStderr
  }

  const trimmedStdout = stdout.trim()
  if (trimmedStdout.length > 0) {
    return trimmedStdout
  }

  return `openclaw ${args.join(" ")} exited with code ${status}`
}

async function runOpenClawCommandAsync(
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<{
  ok: boolean
  status: number
  stdout: string
  stderr: string
  message?: string
  errorCode?: string
}> {
  const timeoutMs = options.timeoutMs ?? 30_000

  return await new Promise((resolve) => {
    const process = spawn("openclaw", args, {
      stdio: ["ignore", "pipe", "pipe"],
    })
    process.stdout?.setEncoding("utf8")
    process.stderr?.setEncoding("utf8")

    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false

    const settle = (result: {
      ok: boolean
      status: number
      stdout: string
      stderr: string
      message?: string
      errorCode?: string
    }): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeoutId)
      resolve(result)
    }

    const timeoutId = setTimeout(() => {
      timedOut = true
      process.kill()
    }, timeoutMs)

    process.stdout?.on("data", (chunk: string) => {
      stdout += chunk
    })
    process.stderr?.on("data", (chunk: string) => {
      stderr += chunk
    })

    process.once("error", (error: NodeJS.ErrnoException) => {
      const result: {
        ok: boolean
        status: number
        stdout: string
        stderr: string
        message?: string
        errorCode?: string
      } = {
        ok: false,
        status: 1,
        stdout,
        stderr,
        message: error.message,
      }

      if (typeof error.code === "string") {
        result.errorCode = error.code
      }

      settle(result)
    })

    process.once("close", (statusCode) => {
      const status = typeof statusCode === "number" ? statusCode : 1
      if (timedOut) {
        settle({
          ok: false,
          status,
          stdout,
          stderr,
          message: `openclaw ${args.join(" ")} timed out after ${Math.round(timeoutMs / 1000)}s`,
        })
        return
      }

      if (status !== 0) {
        settle({
          ok: false,
          status,
          stdout,
          stderr,
          message: formatOpenClawFailure(args, status, stderr, stdout),
        })
        return
      }

      settle({
        ok: true,
        status,
        stdout,
        stderr,
      })
    })
  })
}

async function waitForGatewayHealthy(maxWaitMs = 60_000, pollIntervalMs = 2_000): Promise<string | null> {
  const deadline = Date.now() + maxWaitMs
  let lastError = "Gateway did not report a healthy state."

  while (Date.now() < deadline) {
    const health = await runOpenClawCommandAsync(["gateway", "health", "--json", "--timeout", "5000"], {
      timeoutMs: 10_000,
    })

    if (health.ok) {
      try {
        const parsed = JSON.parse(health.stdout) as Record<string, unknown>
        if (parsed.ok === true) {
          return null
        }

        const reason = typeof parsed.message === "string" ? parsed.message : ""
        lastError = reason.length > 0 ? reason : "Gateway health check returned ok=false."
      } catch {
        const trimmed = health.stdout.trim()
        lastError =
          trimmed.length > 0 ? `Could not parse gateway health JSON: ${trimmed}` : "Malformed gateway health JSON."
      }
    } else {
      lastError = health.message ?? "Gateway health check failed."
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  return `Gateway restart timed out after ${Math.round(maxWaitMs / 1000)}s. Last check: ${lastError}`
}

async function restartGatewayAndWait(): Promise<string | null> {
  const restart = await runOpenClawCommandAsync(["gateway", "restart", "--json"], { timeoutMs: 20_000 })
  if (!restart.ok) {
    return `Could not restart OpenClaw gateway: ${restart.message ?? "unknown error"}`
  }

  return await waitForGatewayHealthy()
}

async function backupWorkspaceRewriteFiles(workspacePath: string): Promise<string[]> {
  const filesToBackup = ["AGENTS.md"] as const
  const backupLogs: string[] = []

  for (const fileName of filesToBackup) {
    const sourcePath = join(workspacePath, fileName)
    if (!(await pathExists(sourcePath))) {
      continue
    }

    const { backupPath, label } = await chooseFileBackupPath(sourcePath)

    try {
      await cp(sourcePath, backupPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not back up ${fileName}: ${message}`)
    }

    backupLogs.push(`Backed up ${fileName} → ${label}`)
  }

  return backupLogs
}

async function countFilesRecursive(path: string): Promise<number> {
  if (!(await isDirectory(path))) {
    return 0
  }

  const entries = await readdir(path, { withFileTypes: true })
  let count = 0

  for (const entry of entries) {
    const nextPath = join(path, entry.name)

    if (entry.isDirectory()) {
      count += await countFilesRecursive(nextPath)
      continue
    }

    if (entry.isFile()) {
      count += 1
    }
  }

  return count
}

function buildMigrateCommand(): string {
  return "npx zettelclaw migrate"
}

async function promptVaultPath(defaultPath: string): Promise<string> {
  return unwrapPrompt(
    await text({
      message: "Where should the vault be created?",
      placeholder: toTildePath(defaultPath),
      defaultValue: defaultPath,
    }),
  )
}

async function promptSyncMethod(defaultMethod: SyncMethod): Promise<SyncMethod> {
  const selection = unwrapPrompt(
    await select({
      message: "How do you want to sync your vault?",
      initialValue: defaultMethod,
      options: [
        { value: "git", label: "Git (recommended)" },
        { value: "obsidian-sync", label: "Obsidian Sync" },
        { value: "none", label: "None" },
      ],
    }),
  )

  if (selection === "git" || selection === "obsidian-sync" || selection === "none") {
    return selection
  }

  throw new Error(`Invalid sync method selected: ${String(selection)}`)
}

async function configureVaultBase(
  vaultPath: string,
  includeAgentFolder: boolean,
  syncMethod: SyncMethod,
  minimal: boolean,
) {
  await configureAgentFolder(vaultPath, includeAgentFolder)
  await copyVaultSeed(vaultPath, { overwrite: false, includeAgent: includeAgentFolder })
  await seedVaultStarterContent(vaultPath, includeAgentFolder)
  await configureCoreSync(vaultPath, syncMethod)
  await configureCommunityPlugins(vaultPath, {
    enabled: true,
    includeGit: syncMethod === "git",
    includeMinimalThemeTools: minimal,
  })
  await configureMinimalTheme(vaultPath, minimal)
}

function downloadVaultPlugins(vaultPath: string, syncMethod: SyncMethod, minimal: boolean): Promise<DownloadResult> {
  return downloadPlugins(vaultPath, {
    includeGit: syncMethod === "git",
    includeMinimal: minimal,
  })
}

async function runOpenClawIntegration(input: {
  openclawRequested: boolean
  shouldCreateSymlinks: boolean
  vaultPath: string
  workspacePath: string
  openclawDir: string
  onRestartStart: () => void
  onRestartStop: (message: string) => void
}): Promise<IntegrationSummary> {
  const summary: IntegrationSummary = {
    hookInstallStatus: null,
    sweepCronStatus: null,
    nightlyMaintenanceCronStatus: null,
    gatewayRestarted: false,
  }

  let symlinkResult: CopyResult = { added: [], skipped: [], failed: [] }
  let configPatched = false
  const integrationFailures: string[] = []

  if (input.shouldCreateSymlinks) {
    symlinkResult = await createAgentSymlinks(input.vaultPath, input.workspacePath)
    if (symlinkResult.failed.length > 0) {
      integrationFailures.push(
        `Could not create agent symlinks:\n${symlinkResult.failed.map((line) => `- ${line}`).join("\n")}`,
      )
    }
  }

  if (input.openclawRequested) {
    const hookInstallResult = await installOpenClawHook(input.openclawDir)
    summary.hookInstallStatus = hookInstallResult.status

    if (summary.hookInstallStatus === "failed") {
      integrationFailures.push(hookInstallResult.message ?? "Could not install OpenClaw hook.")
    }

    const configPatchResult = await patchOpenClawConfig(input.vaultPath, input.openclawDir)
    configPatched = configPatchResult.changed

    if (configPatchResult.message) {
      integrationFailures.push(configPatchResult.message)
    }
  }

  const restartRequired = input.openclawRequested && (summary.hookInstallStatus === "installed" || configPatched)
  if (restartRequired && integrationFailures.length === 0) {
    input.onRestartStart()
    const restartError = await restartGatewayAndWait()
    if (restartError) {
      input.onRestartStop("OpenClaw gateway restart failed")
      integrationFailures.push(restartError)
    } else {
      input.onRestartStop("OpenClaw gateway restarted")
      summary.gatewayRestarted = true
    }
  }

  if (input.openclawRequested && integrationFailures.length === 0) {
    const sweepCronResult = ensureZettelclawSweepCronJob()
    summary.sweepCronStatus = sweepCronResult.status

    if (summary.sweepCronStatus === "failed") {
      integrationFailures.push(sweepCronResult.message ?? "Could not configure zettelclaw-reset cron trigger.")
    }
  }

  if (input.openclawRequested && integrationFailures.length === 0) {
    const nightlyMaintenanceCronResult = await ensureZettelclawNightlyMaintenanceCronJob(input.vaultPath)
    summary.nightlyMaintenanceCronStatus = nightlyMaintenanceCronResult.status

    if (summary.nightlyMaintenanceCronStatus === "failed") {
      integrationFailures.push(
        nightlyMaintenanceCronResult.message ?? "Could not configure zettelclaw-nightly cron trigger.",
      )
    }
  }

  if (integrationFailures.length > 0) {
    throw new Error(`OpenClaw integration failed:\n${integrationFailures.map((line) => `- ${line}`).join("\n")}`)
  }

  return summary
}

async function maybeNotifyAgentUpdate(
  options: InitOptions,
  openclawRequested: boolean,
  workspacePath: string,
  vaultPath: string,
): Promise<void> {
  if (!openclawRequested) {
    return
  }

  const shouldNotify = options.yes
    ? true
    : unwrapPrompt(
        await confirm({
          message: "Notify your OpenClaw agent to update AGENTS.md memory guidance?",
          initialValue: true,
        }),
      )

  if (shouldNotify) {
    await backupWorkspaceRewriteFiles(workspacePath)

    const eventResult = await firePostInitEvent(vaultPath)
    if (eventResult.sent) {
      log.success("Agent notified — it will update AGENTS.md memory guidance")
    } else {
      const templatesDir = resolveSkillPath("templates")
      const reason = eventResult.message ?? "Could not reach the agent. Is the OpenClaw gateway running?"
      log.warn(`${reason}\nYou can manually update using the templates in: ${templatesDir}`)
    }

    return
  }

  const templatesDir = resolveSkillPath("templates")
  log.message(
    [
      "Skipped. You can manually update AGENTS.md memory guidance later.",
      `Template file is: ${join(templatesDir, "agents-memory.md")}`,
    ].join("\n"),
  )
}

export async function runInit(options: InitOptions): Promise<void> {
  intro("🦞 Zettelclaw - Shared human + agent memory")

  const defaultVaultPath = resolveUserPath(DEFAULT_VAULT_PATH)
  const rawVaultPath = options.vaultPath ?? (options.yes ? defaultVaultPath : await promptVaultPath(defaultVaultPath))
  const vaultPath = resolveUserPath(rawVaultPath)

  if ((await pathExists(vaultPath)) && !(await isDirectory(vaultPath))) {
    throw new Error(`Vault path is not a directory: ${vaultPath}`)
  }

  const syncMethod = options.yes ? "git" : await promptSyncMethod("git")
  const workspacePath = resolveUserPath(options.workspacePath ?? DEFAULT_OPENCLAW_WORKSPACE_PATH)
  const explicitWorkspaceConfigured = typeof options.workspacePath === "string" && options.workspacePath.length > 0
  const workspaceDetected = await isDirectory(workspacePath)

  if (explicitWorkspaceConfigured && !workspaceDetected) {
    throw new Error(`OpenClaw workspace not found at ${toTildePath(workspacePath)}`)
  }

  const openclawRequested = workspaceDetected
  const includeAgentFolder = openclawRequested
  const shouldCreateSymlinks = openclawRequested
  const shouldInitGit = syncMethod === "git"
  const openclawDir = dirname(workspacePath)

  if (openclawRequested) {
    configureOpenClawEnvForWorkspace(workspacePath)
  }

  const s = spinner()
  let spinnerActive = false
  const startSpinnerStep = (message: string): void => {
    s.start(message)
    spinnerActive = true
  }
  const completeSpinnerStep = (message: string): void => {
    if (!spinnerActive) {
      return
    }

    s.stop(message)
    spinnerActive = false
  }

  startSpinnerStep("Configuring vault")
  await configureVaultBase(vaultPath, includeAgentFolder, syncMethod, options.minimal)
  completeSpinnerStep("Vault configured")

  startSpinnerStep("Downloading plugins")
  const pluginResult = await downloadVaultPlugins(vaultPath, syncMethod, options.minimal)
  completeSpinnerStep("Plugins downloaded")

  let setupSucceeded = false
  let integrationSummary: IntegrationSummary = {
    hookInstallStatus: null,
    sweepCronStatus: null,
    nightlyMaintenanceCronStatus: null,
    gatewayRestarted: false,
  }

  try {
    integrationSummary = await runOpenClawIntegration({
      openclawRequested,
      shouldCreateSymlinks,
      vaultPath,
      workspacePath,
      openclawDir,
      onRestartStart: () => startSpinnerStep("Restarting OpenClaw gateway (waiting for healthy state)"),
      onRestartStop: (message) => completeSpinnerStep(message),
    })

    await configureApp(vaultPath, includeAgentFolder)

    if (shouldInitGit) {
      const gitDir = join(vaultPath, ".git")
      if (!(await pathExists(gitDir))) {
        const gitInitError = initGitRepository(vaultPath)
        if (gitInitError) {
          log.warn(`Could not initialize Git repository: ${gitInitError}`)
        }
      }
    }

    setupSucceeded = true
  } finally {
    if (spinnerActive) {
      completeSpinnerStep(setupSucceeded ? "Setup complete" : "Setup failed")
    }
  }

  const summaryLines = [`Vault path:  ${toTildePath(vaultPath)}`]

  if (pluginResult.downloaded.length > 0) {
    summaryLines.push(`Plugins:     ${pluginResult.downloaded.join(", ")}`)
  }

  summaryLines.push("Skill:       /zettelclaw")

  if (integrationSummary.hookInstallStatus === "installed" || integrationSummary.hookInstallStatus === "skipped") {
    summaryLines.push("Hooks:       zettelclaw (command:new/reset) replaces session-memory")
  }

  if (integrationSummary.sweepCronStatus === "installed" || integrationSummary.sweepCronStatus === "skipped") {
    summaryLines.push("Cron:        zettelclaw-reset (daily 02:00 local, isolated /reset)")
  }

  if (
    integrationSummary.nightlyMaintenanceCronStatus === "installed" ||
    integrationSummary.nightlyMaintenanceCronStatus === "skipped"
  ) {
    summaryLines.push("Cron:        zettelclaw-nightly (daily 03:00 local, isolated vault maintenance)")
  }

  log.message(summaryLines.join("\n"))

  if (pluginResult.failed.length > 0) {
    log.warn(`Failed to download: ${pluginResult.failed.join(", ")} — install manually from Obsidian`)
  }

  if (!workspaceDetected) {
    log.warn(
      `OpenClaw workspace not found at ${toTildePath(workspacePath)}. Skipped hook install, config patch, and agent symlinks.`,
    )
  }

  if (integrationSummary.gatewayRestarted) {
    log.success("OpenClaw gateway restarted and healthy.")
  }

  await maybeNotifyAgentUpdate(options, openclawRequested, workspacePath, vaultPath)

  log.success("Done! Open it in Obsidian to get started.")
  log.message("Want to migrate historical tasks and conversations? Reclaw: https://reclaw.sh")

  if (openclawRequested) {
    const memoryPath = join(workspacePath, "memory")
    const existingMemoryFileCount = await countFilesRecursive(memoryPath)

    if (existingMemoryFileCount > 0) {
      const fileLabel = existingMemoryFileCount === 1 ? "file" : "files"
      log.warn(
        [
          `Detected ${existingMemoryFileCount} existing ${fileLabel} in ${toTildePath(memoryPath)}.`,
          "Run migrate to import legacy workspace memory:",
          `  ${buildMigrateCommand()}`,
        ].join("\n"),
      )
    }
  }
}
