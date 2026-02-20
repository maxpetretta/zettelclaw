import { join } from "node:path"
import { cancel, intro, isCancel, log, outro, text } from "@clack/prompts"

import { resolveUserPath } from "../lib/paths"
import {
  configureAgentFolder,
  configureApp,
  copyVaultTemplatesOnly,
  detectNotesMode,
  getVaultFolders,
  isDirectory,
  pathExists,
} from "../lib/vault"

export interface UpgradeOptions {
  yes: boolean
  vaultPath?: string | undefined
}

function unwrapPrompt<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Cancelled.")
    process.exit(0)
  }

  return value as T
}

async function promptVaultPath(defaultPath: string): Promise<string> {
  return unwrapPrompt(
    await text({
      message: "Vault path",
      placeholder: defaultPath,
      defaultValue: defaultPath,
    }),
  )
}

async function detectAgentFolder(vaultPath: string): Promise<boolean> {
  const expectedAgentFolder = getVaultFolders(true).agent
  const candidateFolders = [expectedAgentFolder, "03 Agent", "Agent"]

  for (const folder of candidateFolders) {
    if (await pathExists(join(vaultPath, folder))) {
      return true
    }
  }

  return false
}

export async function runUpgrade(options: UpgradeOptions): Promise<void> {
  intro("Zettelclaw upgrade")

  const rawVaultPath = options.vaultPath ?? (options.yes ? process.cwd() : await promptVaultPath(process.cwd()))
  const vaultPath = resolveUserPath(rawVaultPath)

  if (await pathExists(vaultPath)) {
    if (!(await isDirectory(vaultPath))) {
      throw new Error(`Vault path is not a directory: ${vaultPath}`)
    }
  }

  const includeAgent = await detectAgentFolder(vaultPath)
  await configureAgentFolder(vaultPath, includeAgent)
  const notesMode = await detectNotesMode(vaultPath)
  await configureApp(vaultPath, notesMode, includeAgent)

  const result = await copyVaultTemplatesOnly(vaultPath, false)

  log.info(`Added ${result.added.length} template file(s).`)
  log.info(`Skipped ${result.skipped.length} existing template file(s).`)
  outro("Upgrade complete. Existing custom templates were preserved.")
}
