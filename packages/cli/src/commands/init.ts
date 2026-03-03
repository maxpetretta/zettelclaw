import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { intro, log, select, spinner, text } from "@clack/prompts"

import { DEFAULT_OPENCLAW_WORKSPACE_PATH, DEFAULT_VAULT_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import { ensureOpenClawMemoryPath } from "../lib/openclaw"
import { configureOpenClawEnvForWorkspace } from "../lib/openclaw-workspace"
import { resolveUserPath } from "../lib/paths"
import { type DownloadResult, downloadPlugins } from "../lib/plugins"
import { configureAgentFolder, createAgentSymlinks } from "../lib/vault-agent"
import { isDirectory, pathExists } from "../lib/vault-fs"
import {
  configureApp,
  configureCommunityPlugins,
  configureCoreSync,
  configureMinimalTheme,
  type SyncMethod,
} from "../lib/vault-obsidian"
import { copyVaultSeed, seedVaultStarterContent } from "../lib/vault-seed"

export interface InitOptions {
  yes: boolean
  vaultPath?: string | undefined
  minimal: boolean
  workspacePath?: string | undefined
  syncMethod?: SyncMethod | undefined
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
        { value: "git", label: "Git" },
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

async function promptMinimalTheme(defaultEnabled: boolean): Promise<boolean> {
  const selection = unwrapPrompt(
    await select({
      message: "Choose a theme preset",
      initialValue: defaultEnabled ? "minimal" : "default",
      options: [
        { value: "minimal", label: "Minimal theme (default)" },
        { value: "default", label: "Obsidian default theme" },
      ],
    }),
  )

  if (selection === "minimal") {
    return true
  }

  if (selection === "default") {
    return false
  }

  throw new Error(`Invalid theme option selected: ${String(selection)}`)
}

function downloadVaultPlugins(vaultPath: string, syncMethod: SyncMethod, minimal: boolean): Promise<DownloadResult> {
  return downloadPlugins(vaultPath, {
    includeGit: syncMethod === "git",
    includeMinimal: minimal,
  })
}

export async function runInit(options: InitOptions): Promise<void> {
  intro("🦞 Zettelclaw - Install vault")

  const defaultVaultPath = resolveUserPath(DEFAULT_VAULT_PATH)
  const rawVaultPath = options.vaultPath ?? (options.yes ? defaultVaultPath : await promptVaultPath(defaultVaultPath))
  const vaultPath = resolveUserPath(rawVaultPath)

  if ((await pathExists(vaultPath)) && !(await isDirectory(vaultPath))) {
    throw new Error(`Vault path is not a directory: ${vaultPath}`)
  }

  const syncMethod = options.syncMethod ?? (options.yes ? "git" : await promptSyncMethod("git"))
  const minimal = options.yes ? true : options.minimal || (await promptMinimalTheme(true))

  const workspacePath = resolveUserPath(options.workspacePath ?? DEFAULT_OPENCLAW_WORKSPACE_PATH)
  const explicitWorkspaceConfigured = typeof options.workspacePath === "string" && options.workspacePath.length > 0
  const workspaceDetected = await isDirectory(workspacePath)

  if (explicitWorkspaceConfigured && !workspaceDetected) {
    throw new Error(`OpenClaw workspace not found at ${toTildePath(workspacePath)}`)
  }

  const includeAgentFolder = workspaceDetected
  if (workspaceDetected) {
    configureOpenClawEnvForWorkspace(workspacePath)
  }

  const s = spinner()

  s.start("Configuring vault files")
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
  await configureApp(vaultPath, includeAgentFolder)
  s.stop("Vault configured")

  s.start("Downloading plugins")
  const pluginResult = await downloadVaultPlugins(vaultPath, syncMethod, minimal)
  s.stop("Plugin download finished")

  // Plugin downloads replace plugin directories; re-apply plugin config files afterward.
  await configureCommunityPlugins(vaultPath, {
    enabled: true,
    includeGit: syncMethod === "git",
    includeMinimalThemeTools: minimal,
  })
  await configureMinimalTheme(vaultPath, minimal)

  if (syncMethod === "git") {
    const gitDir = join(vaultPath, ".git")
    if (!(await pathExists(gitDir))) {
      const gitInitError = initGitRepository(vaultPath)
      if (gitInitError) {
        log.warn(`Could not initialize Git repository: ${gitInitError}`)
      }
    }
  }

  const summaryLines = [`Vault path: ${toTildePath(vaultPath)}`]
  if (pluginResult.downloaded.length > 0) {
    summaryLines.push(`Plugins: ${pluginResult.downloaded.join(", ")}`)
  }

  if (workspaceDetected) {
    const symlinkResult = await createAgentSymlinks(vaultPath, workspacePath)
    const openclawConfigPath = join(dirname(workspacePath), "openclaw.json")
    const openclawPatch = await ensureOpenClawMemoryPath(vaultPath, openclawConfigPath)

    if (symlinkResult.added.length > 0) {
      summaryLines.push(`Agent links: ${symlinkResult.added.length} created`)
    }

    if (symlinkResult.failed.length > 0) {
      log.warn(`Could not create some symlinks:\n${symlinkResult.failed.map((line) => `- ${line}`).join("\n")}`)
    }

    if (openclawPatch.changed) {
      summaryLines.push("OpenClaw config: memory path added")
    }

    if (openclawPatch.message) {
      log.warn(openclawPatch.message)
    }
  } else {
    log.warn(
      `OpenClaw workspace not found at ${toTildePath(workspacePath)}. Skipped agent symlinks and memory-path patch.`,
    )
  }

  log.message(summaryLines.join("\n"))

  if (pluginResult.failed.length > 0) {
    log.warn(`Failed to download: ${pluginResult.failed.join(", ")} — install manually from Obsidian`)
  }

  log.success("Done. Open your vault in Obsidian to start using the template.")
}
