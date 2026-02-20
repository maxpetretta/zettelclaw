import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { confirm, intro, log, select, spinner, text } from "@clack/prompts"
import { DEFAULT_OPENCLAW_WORKSPACE_PATH, DEFAULT_VAULT_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import { firePostInitEvent, installOpenClawHook, patchOpenClawConfig } from "../lib/openclaw"
import { resolveUserPath } from "../lib/paths"
import { downloadPlugins } from "../lib/plugins"
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
  const workspaceDetected = await isDirectory(workspacePath)
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
  let symlinkResult: CopyResult = { added: [], skipped: [], failed: [] }

  if (shouldCreateSymlinks) {
    symlinkResult = await createAgentSymlinks(vaultPath, workspacePath)
  }

  if (openclawRequested) {
    const hookInstallResult = await installOpenClawHook(openclawDir)
    hookInstallStatus = hookInstallResult.status
    hookInstallMessage = hookInstallResult.message

    const configPatchResult = await patchOpenClawConfig(vaultPath, openclawDir)
    configPatched = configPatchResult.changed
    configPatchMessage = configPatchResult.message
  }

  await configureApp(vaultPath, includeAgentFolder)

  let gitInitError: string | null = null

  if (shouldInitGit) {
    const gitDir = join(vaultPath, ".git")

    if (!(await pathExists(gitDir))) {
      gitInitError = initGitRepository(vaultPath)
    }
  }

  s.stop("Setup complete")

  const summaryLines = [`Vault path:  ${toTildePath(vaultPath)}`]

  if (pluginResult.downloaded.length > 0) {
    summaryLines.push(`Plugins:     ${pluginResult.downloaded.join(", ")}`)
  }

  summaryLines.push("Skill:       /zettelclaw")

  if (hookInstallStatus === "installed" || hookInstallStatus === "skipped") {
    summaryLines.push("Hooks:       zettelclaw (command:new) replaces session-memory")
  }

  log.message(summaryLines.join("\n"))

  if (pluginResult.failed.length > 0) {
    log.warn(`Failed to download: ${pluginResult.failed.join(", ")} — install manually from Obsidian`)
  }

  if (symlinkResult.failed.length > 0) {
    log.warn(
      `Could not create some agent symlinks (likely permissions):\n${symlinkResult.failed.map((line) => `- ${line}`).join("\n")}`,
    )
  }

  if (gitInitError) {
    log.warn(`Could not initialize Git repository: ${gitInitError}`)
  }

  if (!workspaceDetected) {
    log.warn(
      `OpenClaw workspace not found at ${toTildePath(workspacePath)}. Skipped hook install, config patch, and agent symlinks.`,
    )
  }

  if (hookInstallStatus === "failed") {
    log.warn(hookInstallMessage ?? "Could not install OpenClaw hook.")
  }

  if (configPatchMessage) {
    log.warn(configPatchMessage)
  }

  if (openclawRequested && (hookInstallStatus === "installed" || configPatched)) {
    log.warn("Restart OpenClaw gateway for hook and config changes to take effect.")
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
      const projectPath = join(import.meta.dirname, "../..")
      const eventResult = await firePostInitEvent(vaultPath, projectPath)
      if (eventResult.sent) {
        log.success("Agent notified — it will update AGENTS.md and HEARTBEAT.md")
      } else {
        const reason = eventResult.message ?? "Could not reach the agent. Is the OpenClaw gateway running?"
        log.warn(`${reason}\nYou can manually update using the templates in: templates/`)
      }
    } else {
      log.message(
        "Skipped. You can manually update AGENTS.md and HEARTBEAT.md later.\nTemplate files are in: templates/agents-memory.md, agents-heartbeat.md, heartbeat.md",
      )
    }
  }

  log.success("Done! Open it in Obsidian to get started.")
}
