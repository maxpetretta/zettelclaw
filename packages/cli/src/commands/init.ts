import { spawnSync } from "node:child_process"
import { cp } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { confirm, intro, log, select, spinner, text } from "@clack/prompts"
import { DEFAULT_OPENCLAW_WORKSPACE_PATH, DEFAULT_VAULT_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import {
  ensureZettelclawSweepCronJob,
  firePostInitEvent,
  installOpenClawHook,
  patchOpenClawConfig,
} from "../lib/openclaw"
import { resolveUserPath } from "../lib/paths"
import { downloadPlugins } from "../lib/plugins"
import { resolveSkillPath } from "../lib/skill"
import {
  type CopyResult,
  configureAgentFolder,
  configureApp,
  configureCommunityPlugins,
  configureCoreSync,
  configureMinimalTheme,
  copyVaultSeed,
  createAgentSymlinks,
  isDirectory,
  pathExists,
  type SyncMethod,
} from "../lib/vault"

export interface InitOptions {
  yes: boolean
  vaultPath?: string | undefined
  minimal: boolean
  workspacePath?: string | undefined
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

interface CommandOutcome {
  ok: boolean
  stdout: string
  stderr: string
  message?: string
}

function runOpenClawCommand(args: string[], timeoutMs: number): CommandOutcome {
  const result = spawnSync("openclaw", args, {
    encoding: "utf8",
    timeout: timeoutMs,
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

async function waitForGatewayHealthy(maxWaitMs = 60_000, pollIntervalMs = 2_000): Promise<string | null> {
  const deadline = Date.now() + maxWaitMs
  let lastError = "Gateway did not report a healthy state."

  while (Date.now() < deadline) {
    const health = runOpenClawCommand(["gateway", "health", "--json", "--timeout", "5000"], 10_000)

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
  const restart = runOpenClawCommand(["gateway", "restart", "--json"], 20_000)
  if (!restart.ok) {
    return `Could not restart OpenClaw gateway: ${restart.message ?? "unknown error"}`
  }

  return await waitForGatewayHealthy()
}

async function chooseFileBackupPath(sourcePath: string): Promise<{ backupPath: string; label: string }> {
  const sourceName = basename(sourcePath)
  const sourceDirectory = dirname(sourcePath)
  const maxAttempts = 10_000

  for (let index = 0; index < maxAttempts; index += 1) {
    const label = index === 0 ? `${sourceName}.bak` : `${sourceName}.bak.${index}`
    const backupPath = join(sourceDirectory, label)

    if (!(await pathExists(backupPath))) {
      return { backupPath, label }
    }
  }

  throw new Error(
    `Could not find an available backup path for ${sourceName} under ${toTildePath(sourceDirectory)} after ${maxAttempts} attempts`,
  )
}

async function backupWorkspaceRewriteFiles(workspacePath: string): Promise<string[]> {
  const filesToBackup = ["AGENTS.md", "HEARTBEAT.md"] as const
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

export async function runInit(options: InitOptions): Promise<void> {
  intro("🦞 Welcome to Zettelclaw")

  const defaultVaultPath = resolveUserPath(DEFAULT_VAULT_PATH)
  const rawVaultPath = options.vaultPath ?? (options.yes ? defaultVaultPath : await promptVaultPath(defaultVaultPath))
  const vaultPath = resolveUserPath(rawVaultPath)

  if (await pathExists(vaultPath)) {
    if (!(await isDirectory(vaultPath))) {
      throw new Error(`Vault path is not a directory: ${vaultPath}`)
    }
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

  const s = spinner()
  s.start("Configuring vault")

  await configureAgentFolder(vaultPath, includeAgentFolder)
  await copyVaultSeed(vaultPath, { overwrite: false, includeAgent: includeAgentFolder })
  await configureCoreSync(vaultPath, syncMethod)
  await configureCommunityPlugins(vaultPath, {
    enabled: true,
    includeGit: syncMethod === "git",
    includeMinimalThemeTools: options.minimal,
  })
  await configureMinimalTheme(vaultPath, options.minimal)

  s.message("Downloading plugins")
  const pluginResult = await downloadPlugins(vaultPath, {
    includeGit: syncMethod === "git",
    includeMinimal: options.minimal,
  })

  let configPatched = false
  let hookInstallStatus: "installed" | "skipped" | "failed" | null = null
  let hookInstallMessage: string | undefined
  let configPatchMessage: string | undefined
  let sweepCronStatus: "installed" | "skipped" | "failed" | null = null
  let sweepCronMessage: string | undefined
  let gatewayRestarted = false
  let symlinkResult: CopyResult = { added: [], skipped: [], failed: [] }
  const integrationFailures: string[] = []
  let setupSucceeded = false

  try {
    if (shouldCreateSymlinks) {
      symlinkResult = await createAgentSymlinks(vaultPath, workspacePath)
      if (symlinkResult.failed.length > 0) {
        integrationFailures.push(
          `Could not create agent symlinks:\n${symlinkResult.failed.map((line) => `- ${line}`).join("\n")}`,
        )
      }
    }

    if (openclawRequested) {
      const hookInstallResult = await installOpenClawHook(openclawDir)
      hookInstallStatus = hookInstallResult.status
      hookInstallMessage = hookInstallResult.message

      if (hookInstallStatus === "failed") {
        integrationFailures.push(hookInstallMessage ?? "Could not install OpenClaw hook.")
      }

      const configPatchResult = await patchOpenClawConfig(vaultPath, openclawDir)
      configPatched = configPatchResult.changed
      configPatchMessage = configPatchResult.message

      if (configPatchMessage) {
        integrationFailures.push(configPatchMessage)
      }
    }

    const restartRequired = openclawRequested && (hookInstallStatus === "installed" || configPatched)
    if (restartRequired && integrationFailures.length === 0) {
      s.message("Restarting OpenClaw gateway")
      const restartError = await restartGatewayAndWait()
      if (restartError) {
        integrationFailures.push(restartError)
      } else {
        gatewayRestarted = true
      }
    }

    if (openclawRequested && integrationFailures.length === 0) {
      const sweepCronResult = ensureZettelclawSweepCronJob()
      sweepCronStatus = sweepCronResult.status
      sweepCronMessage = sweepCronResult.message

      if (sweepCronStatus === "failed") {
        integrationFailures.push(sweepCronMessage ?? "Could not configure zettelclaw-sweep cron trigger.")
      }
    }

    if (integrationFailures.length > 0) {
      throw new Error(`OpenClaw integration failed:\n${integrationFailures.map((line) => `- ${line}`).join("\n")}`)
    }

    await configureApp(vaultPath, includeAgentFolder)

    let gitInitError: string | null = null

    if (shouldInitGit) {
      const gitDir = join(vaultPath, ".git")

      if (!(await pathExists(gitDir))) {
        gitInitError = initGitRepository(vaultPath)
      }
    }

    if (gitInitError) {
      log.warn(`Could not initialize Git repository: ${gitInitError}`)
    }

    setupSucceeded = true
  } finally {
    s.stop(setupSucceeded ? "Setup complete" : "Setup failed")
  }

  const summaryLines = [`Vault path:  ${toTildePath(vaultPath)}`]

  if (pluginResult.downloaded.length > 0) {
    summaryLines.push(`Plugins:     ${pluginResult.downloaded.join(", ")}`)
  }

  summaryLines.push("Skill:       /zettelclaw")

  if (hookInstallStatus === "installed" || hookInstallStatus === "skipped") {
    summaryLines.push("Hooks:       zettelclaw (command:new/reset) replaces session-memory")
  }

  if (sweepCronStatus === "installed" || sweepCronStatus === "skipped") {
    summaryLines.push("Cron:        zettelclaw-sweep (every 30m, isolated /reset)")
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

  if (gatewayRestarted) {
    log.success("OpenClaw gateway restarted and healthy.")
  }

  // Prompt to notify the agent to update workspace files
  if (openclawRequested) {
    const shouldNotify = options.yes
      ? true
      : unwrapPrompt(
          await confirm({
            message: "Notify your OpenClaw agent to update AGENTS.md and HEARTBEAT.md?",
            initialValue: true,
          }),
        )

    if (shouldNotify) {
      await backupWorkspaceRewriteFiles(workspacePath)

      const eventResult = await firePostInitEvent(vaultPath)
      if (eventResult.sent) {
        log.success("Agent notified — it will update AGENTS.md and HEARTBEAT.md")
      } else {
        const templatesDir = resolveSkillPath("templates")
        const reason = eventResult.message ?? "Could not reach the agent. Is the OpenClaw gateway running?"
        log.warn(`${reason}\nYou can manually update using the templates in: ${templatesDir}`)
      }
    } else {
      const templatesDir = resolveSkillPath("templates")
      log.message(
        [
          "Skipped. You can manually update AGENTS.md and HEARTBEAT.md later.",
          `Template files are in: ${join(templatesDir, "agents-memory.md")}, ${join(templatesDir, "agents-heartbeat.md")}, ${join(templatesDir, "heartbeat.md")}`,
        ].join("\n"),
      )
    }
  }

  log.success("Done! Open it in Obsidian to get started.")
}
