import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { confirm, intro, isCancel, select, spinner, text } from "@clack/prompts"

import { firePostInitEvent, installOpenClawHook, patchOpenClawConfig } from "../lib/openclaw"
import { resolveUserPath } from "../lib/paths"
import { downloadPlugins } from "../lib/plugins"
import {
  configureAgentFolder,
  configureApp,
  configureCommunityPlugins,
  configureCoreSync,
  configureMinimalTheme,
  configureTemplatesForCommunity,
  copyVaultSeed,
  createAgentSymlinks,
  isDirectory,
  type NotesMode,
  pathExists,
  type SyncMethod,
} from "../lib/vault"

export interface InitOptions {
  openclaw: boolean
  yes: boolean
  vaultPath?: string | undefined
  minimal: boolean
  workspacePath?: string | undefined
  initGit?: boolean | undefined
}

function unwrapPrompt<T>(value: T | symbol): T {
  if (isCancel(value)) {
    process.exit(0)
  }

  return value as T
}

function toTildePath(p: string): string {
  const home = process.env["HOME"] ?? ""
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p
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
  return unwrapPrompt(
    await select({
      message: "How do you want to sync your vault?",
      initialValue: defaultMethod,
      options: [
        { value: "git", label: "Git (recommended)" },
        { value: "obsidian-sync", label: "Obsidian Sync" },
        { value: "none", label: "None" },
      ],
    }),
  ) as SyncMethod
}

export async function runInit(options: InitOptions): Promise<void> {
  intro("Zettelclaw init")

  const defaultVaultPath = join(process.cwd(), "zettelclaw")
  const rawVaultPath = options.vaultPath ?? (options.yes ? defaultVaultPath : await promptVaultPath(defaultVaultPath))
  const vaultPath = resolveUserPath(rawVaultPath)

  if (await pathExists(vaultPath)) {
    if (!(await isDirectory(vaultPath))) {
      throw new Error(`Vault path is not a directory: ${vaultPath}`)
    }
  }

  const syncMethod = options.yes ? "git" : await promptSyncMethod("git")
  const mode: NotesMode = "notes"
  const workspacePath = resolveUserPath(options.workspacePath ?? "~/.openclaw/workspace")
  const workspaceDetected = await isDirectory(workspacePath)
  const openclawRequested = options.openclaw || workspaceDetected
  const includeAgentFolder = openclawRequested
  const shouldCreateSymlinks = openclawRequested && (options.openclaw || workspaceDetected)
  const shouldInitGit = options.initGit ?? true
  const openclawDir = resolveUserPath(join(workspacePath, ".."))

  const s = spinner()
  s.start("Configuring vault")

  await configureAgentFolder(vaultPath, includeAgentFolder)
  await copyVaultSeed(vaultPath, { mode, overwrite: false, includeAgent: includeAgentFolder })
  await configureCoreSync(vaultPath, syncMethod)
  await configureCommunityPlugins(vaultPath, {
    enabled: true,
    includeGit: syncMethod === "git",
    includeMinimalThemeTools: options.minimal,
  })
  await configureTemplatesForCommunity(vaultPath, true)
  await configureMinimalTheme(vaultPath, options.minimal)

  s.message("Downloading plugins")
  const pluginResult = await downloadPlugins(vaultPath, {
    includeGit: syncMethod === "git",
    includeMinimal: options.minimal,
  })

  let configPatched = false
  let hookInstallStatus: "installed" | "skipped" | "failed" | null = null

  if (shouldCreateSymlinks) {
    await createAgentSymlinks(vaultPath, workspacePath)
  }

  if (openclawRequested) {
    hookInstallStatus = await installOpenClawHook(openclawDir)
    configPatched = await patchOpenClawConfig(vaultPath, openclawDir)
  }

  await configureApp(vaultPath, mode, includeAgentFolder)

  if (shouldInitGit) {
    const gitDir = join(vaultPath, ".git")

    if (!(await pathExists(gitDir))) {
      spawnSync("git", ["init"], {
        cwd: vaultPath,
        encoding: "utf8",
      })
    }
  }

  s.stop("Setup complete")

  console.log("")
  console.log(`│  Vault path:  ${toTildePath(vaultPath)}`)

  const plugins = [...pluginResult.downloaded, ...pluginResult.failed]
  if (plugins.length > 0) {
    console.log(`│  Plugins:     ${plugins.join(", ")}`)
  }

  console.log("│  Skill:       zettelclaw")

  const hooks: string[] = []
  if (hookInstallStatus === "installed" || hookInstallStatus === "skipped") {
    hooks.push("zettelclaw")
  }
  if (hooks.length > 0) {
    console.log(`│  Hooks:       ${hooks.join(", ")}`)
  }

  if (pluginResult.failed.length > 0) {
    console.log(`│`)
    console.log(`│  ⚠ Failed to download: ${pluginResult.failed.join(", ")} — install manually from Obsidian`)
  }

  if (openclawRequested && (hookInstallStatus === "installed" || configPatched)) {
    console.log("│")
    console.log("│  ⚠ Restart OpenClaw gateway for hook and config changes to take effect.")
  }

  console.log("")

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
      const sent = await firePostInitEvent(vaultPath, projectPath)
      if (sent) {
        console.log("│  ✓ Agent notified — it will update AGENTS.md and HEARTBEAT.md")
      } else {
        console.log("│  ⚠ Could not reach the agent. Is the OpenClaw gateway running?")
        console.log("│    You can manually update using the templates in: templates/")
      }
    } else {
      console.log("│  Skipped. You can manually update AGENTS.md and HEARTBEAT.md later.")
      console.log("│    Template files are in: templates/agents-memory.md, agents-heartbeat.md, heartbeat.md")
    }
  }

  console.log("\nDone! Open it in Obsidian to get started.")
}
