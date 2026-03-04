import { intro, log, select, spinner, text } from "@clack/prompts"

import { DEFAULT_VAULT_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import { resolveUserPath } from "../lib/paths"
import { downloadPlugins } from "../lib/plugins"
import { isDirectory } from "../lib/vault-fs"
import {
  configureApp,
  configureCommunityPlugins,
  configureCoreSync,
  configureMinimalTheme,
  type SyncMethod,
} from "../lib/vault-obsidian"

export interface InstallPluginsOptions {
  yes: boolean
  vaultPath?: string | undefined
  minimal: boolean
  syncMethod?: SyncMethod | undefined
}

async function promptVaultPath(defaultPath: string): Promise<string> {
  return unwrapPrompt(
    await text({
      message: "Where is your Zettelclaw vault?",
      placeholder: toTildePath(defaultPath),
      defaultValue: defaultPath,
    }),
  )
}

async function promptSyncMethod(defaultMethod: SyncMethod): Promise<SyncMethod> {
  const selection = unwrapPrompt(
    await select({
      message: "Which sync mode should plugin setup assume?",
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

export async function runInstallPlugins(options: InstallPluginsOptions): Promise<void> {
  intro("🦞 Zettelclaw - Install plugins")

  const defaultVaultPath = resolveUserPath(DEFAULT_VAULT_PATH)
  const rawVaultPath = options.vaultPath ?? (options.yes ? defaultVaultPath : await promptVaultPath(defaultVaultPath))
  const vaultPath = resolveUserPath(rawVaultPath)

  if (!(await isDirectory(vaultPath))) {
    throw new Error(`Vault not found at ${toTildePath(vaultPath)}. Run \`zettelclaw init\` first.`)
  }

  const syncMethod = options.syncMethod ?? (options.yes ? "git" : await promptSyncMethod("git"))

  const s = spinner()
  s.start("Updating plugin config")

  await configureCoreSync(vaultPath, syncMethod)
  await configureCommunityPlugins(vaultPath, {
    enabled: true,
    includeGit: syncMethod === "git",
    includeMinimalThemeTools: options.minimal,
  })
  await configureMinimalTheme(vaultPath, options.minimal)

  s.stop("Plugin config updated")

  s.start("Downloading plugin binaries")
  const pluginResult = await downloadPlugins(vaultPath, {
    includeGit: syncMethod === "git",
    includeMinimal: options.minimal,
  })
  s.stop("Plugin binaries downloaded")

  // Plugin downloads replace plugin directories; re-apply plugin config files afterward.
  await configureCommunityPlugins(vaultPath, {
    enabled: true,
    includeGit: syncMethod === "git",
    includeMinimalThemeTools: options.minimal,
  })
  await configureMinimalTheme(vaultPath, options.minimal)

  await configureApp(vaultPath)

  log.message(
    [`Vault path: ${toTildePath(vaultPath)}`, `Downloaded: ${pluginResult.downloaded.join(", ") || "none"}`].join("\n"),
  )

  if (pluginResult.failed.length > 0) {
    log.warn(`Failed downloads: ${pluginResult.failed.join(", ")}`)
  }

  log.success("Plugin installation complete.")
}
