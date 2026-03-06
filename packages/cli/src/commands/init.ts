import { spawnSync } from "node:child_process"
import { basename, dirname, join } from "node:path"
import { intro, log, select, spinner, text } from "@clack/prompts"

import {
  DEFAULT_OPENCLAW_WORKSPACE_PATH,
  DEFAULT_VAULT_PATH,
  formatCommandIntro,
  type ThemePreset,
  toTildePath,
  unwrapPrompt,
} from "../lib/cli"
import { ensureOpenClawMemoryPath } from "../lib/openclaw"
import { configureOpenClawEnvForWorkspace } from "../lib/openclaw-workspace"
import { resolveUserPath } from "../lib/paths"
import { type DownloadResult, downloadPlugins } from "../lib/plugins"
import { ensureQmdCollections, expectedQmdCollections, installQmdGlobal } from "../lib/qmd"
import { configureVaultFolders } from "../lib/vault-folders"
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
  theme?: ThemePreset | undefined
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
        { value: "git", label: "Git (Recommended)" },
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

async function promptTheme(defaultTheme: ThemePreset): Promise<ThemePreset> {
  const selection = unwrapPrompt(
    await select({
      message: "Choose a theme preset",
      initialValue: defaultTheme,
      options: [
        { value: "minimal", label: "Minimal (Recommended)" },
        { value: "obsidian", label: "Obsidian" },
      ],
    }),
  )

  if (selection === "minimal" || selection === "obsidian") {
    return selection
  }

  throw new Error(`Invalid theme option selected: ${String(selection)}`)
}

function themeUsesMinimalTools(theme: ThemePreset): boolean {
  return theme === "minimal"
}

function downloadVaultPlugins(vaultPath: string, syncMethod: SyncMethod, theme: ThemePreset): Promise<DownloadResult> {
  return downloadPlugins(vaultPath, {
    includeGit: syncMethod === "git",
    includeMinimal: themeUsesMinimalTools(theme),
  })
}

async function promptInstallQmd(): Promise<boolean> {
  const selection = unwrapPrompt(
    await select({
      message: "QMD is not installed. Install it globally now?",
      initialValue: "install",
      options: [
        { value: "install", label: "Install QMD now" },
        { value: "skip", label: "Skip for now" },
      ],
    }),
  )

  if (selection === "install") {
    return true
  }

  if (selection === "skip") {
    return false
  }

  throw new Error(`Invalid QMD install option selected: ${String(selection)}`)
}

function buildQmdCollectionSummary(vaultPath: string, configuredCollections: readonly string[]): string | null {
  const labels = expectedQmdCollections(vaultPath)
    .filter((collection) => configuredCollections.includes(collection.name))
    .map((collection) => basename(collection.path).replace(/^\d{2}\s+/u, ""))

  return labels.length > 0 ? labels.join(", ") : null
}

export async function runInit(options: InitOptions): Promise<void> {
  intro(formatCommandIntro("Install vault"))

  const defaultVaultPath = resolveUserPath(DEFAULT_VAULT_PATH)
  const rawVaultPath = options.vaultPath ?? (options.yes ? defaultVaultPath : await promptVaultPath(defaultVaultPath))
  const vaultPath = resolveUserPath(rawVaultPath)

  if ((await pathExists(vaultPath)) && !(await isDirectory(vaultPath))) {
    throw new Error(`Vault path is not a directory: ${vaultPath}`)
  }

  const syncMethod = options.syncMethod ?? (options.yes ? "git" : await promptSyncMethod("git"))
  const theme = options.theme ?? (options.yes ? "minimal" : await promptTheme("minimal"))
  const minimal = themeUsesMinimalTools(theme)

  const workspacePath = resolveUserPath(options.workspacePath ?? DEFAULT_OPENCLAW_WORKSPACE_PATH)
  const explicitWorkspaceConfigured = typeof options.workspacePath === "string" && options.workspacePath.length > 0
  const workspaceDetected = await isDirectory(workspacePath)

  if (explicitWorkspaceConfigured && !workspaceDetected) {
    throw new Error(`OpenClaw workspace not found at ${toTildePath(workspacePath)}`)
  }

  if (workspaceDetected) {
    configureOpenClawEnvForWorkspace(workspacePath)
  }

  const s = spinner()

  s.start("Configuring vault files")
  await configureVaultFolders(vaultPath)
  await copyVaultSeed(vaultPath, { overwrite: false })
  await seedVaultStarterContent(vaultPath)
  await configureCoreSync(vaultPath, syncMethod)
  await configureCommunityPlugins(vaultPath, {
    enabled: true,
    includeGit: syncMethod === "git",
    includeMinimalThemeTools: minimal,
  })
  await configureMinimalTheme(vaultPath, minimal)
  await configureApp(vaultPath)
  s.stop("Vault configured")

  s.start("Downloading plugins")
  const pluginResult = await downloadVaultPlugins(vaultPath, syncMethod, theme)
  s.stop("Plugin downloads finished")

  // Plugin downloads replace plugin directories; re-apply plugin config files afterward.
  await configureCommunityPlugins(vaultPath, {
    enabled: true,
    includeGit: syncMethod === "git",
    includeMinimalThemeTools: minimal,
  })
  await configureMinimalTheme(vaultPath, minimal)

  s.start("Configuring QMD collections")
  let qmdResult = await ensureQmdCollections(vaultPath)

  if (qmdResult.skipped && qmdResult.missingBinary && !options.yes) {
    s.stop("QMD not installed")

    if (await promptInstallQmd()) {
      s.start("Installing QMD")
      const installQmdResult = await installQmdGlobal()

      if (installQmdResult.installed) {
        const command = installQmdResult.command ? ` (${installQmdResult.command})` : ""
        s.stop(`QMD installed${command}`)

        s.start("Configuring QMD collections")
        qmdResult = await ensureQmdCollections(vaultPath)
        s.stop(qmdResult.skipped ? "QMD setup skipped" : "QMD collections configured")
      } else {
        s.stop("QMD install failed")
        if (installQmdResult.message) {
          log.warn(installQmdResult.message)
        }
      }
    } else {
      log.warn(
        "Skipped QMD installation. Install later with `bun install -g @tobilu/qmd` (or `npm install -g @tobilu/qmd`) and rerun `zettelclaw init`.",
      )
    }
  } else {
    s.stop(qmdResult.skipped ? "QMD setup skipped" : "QMD collections configured")
  }

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
  const qmdCollectionSummary = buildQmdCollectionSummary(vaultPath, qmdResult.configured)
  summaryLines.push(`QMD collections: ${qmdCollectionSummary ?? "none"}`)
  summaryLines.push(`Plugins: ${pluginResult.downloaded.join(", ") || "none"}`)

  if (workspaceDetected) {
    const openclawConfigPath = join(dirname(workspacePath), "openclaw.json")
    const openclawPatch = await ensureOpenClawMemoryPath(vaultPath, openclawConfigPath)

    if (openclawPatch.changed) {
      summaryLines.push("OpenClaw config: memory path added")
    }

    if (openclawPatch.message) {
      log.warn(openclawPatch.message)
    }
  } else {
    log.warn(`OpenClaw workspace not found at ${toTildePath(workspacePath)}. Skipped memory-path patch.`)
  }

  log.message(summaryLines.join("\n"))

  if (pluginResult.failed.length > 0) {
    log.warn(`Failed plugin downloads: ${pluginResult.failed.join(", ")} — install manually from Obsidian`)
  }

  if (qmdResult.message) {
    log.warn(qmdResult.message)
  }

  if (qmdResult.failed.length > 0) {
    log.warn(`QMD collection failures:\n${qmdResult.failed.map((line) => `- ${line}`).join("\n")}`)
  }

  log.success("Done! Open your vault in Obsidian to get started")
}
