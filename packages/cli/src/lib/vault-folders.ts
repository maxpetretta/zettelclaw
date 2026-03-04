import { lstat, mkdir, readdir, rename } from "node:fs/promises"
import { join } from "node:path"

import {
  ATTACHMENTS_FOLDER_ALIASES,
  FOLDERS,
  JOURNAL_FOLDER_ALIASES,
  LEGACY_AGENT_FOLDER_ALIASES,
  LEGACY_FOLDERS,
  TEMPLATES_FOLDER_ALIASES,
} from "./folders"
import { pathExists, removePathIfExists } from "./vault-fs"

async function moveFolderIfPossible(vaultPath: string, sourceFolder: string, destinationFolder: string): Promise<void> {
  const sourcePath = join(vaultPath, sourceFolder)
  const destinationPath = join(vaultPath, destinationFolder)

  if (!(await pathExists(sourcePath))) {
    return
  }

  if (await pathExists(destinationPath)) {
    return
  }

  await rename(sourcePath, destinationPath)
}

async function moveFirstAliasToCanonical(
  vaultPath: string,
  canonicalFolder: string,
  aliasFolders: readonly string[],
): Promise<void> {
  const canonicalPath = join(vaultPath, canonicalFolder)

  if (await pathExists(canonicalPath)) {
    return
  }

  for (const alias of aliasFolders) {
    if (alias === canonicalFolder) {
      continue
    }

    const aliasPath = join(vaultPath, alias)
    if (await pathExists(aliasPath)) {
      await rename(aliasPath, canonicalPath)
      return
    }
  }
}

async function folderContainsOnlyManagedAgentEntries(pathToFolder: string): Promise<boolean> {
  if (!(await pathExists(pathToFolder))) {
    return false
  }

  const entries = await readdir(pathToFolder, { withFileTypes: true })

  if (entries.length === 0) {
    return true
  }

  for (const entry of entries) {
    if (entry.name === ".gitkeep") {
      continue
    }

    const entryPath = join(pathToFolder, entry.name)
    const stats = await lstat(entryPath)

    if (!stats.isSymbolicLink()) {
      return false
    }
  }

  return true
}

async function removeManagedAgentFolderIfSafe(vaultPath: string, folderName: string): Promise<void> {
  const folderPath = join(vaultPath, folderName)

  if (!(await pathExists(folderPath))) {
    return
  }

  if (await folderContainsOnlyManagedAgentEntries(folderPath)) {
    await removePathIfExists(folderPath)
  }
}

export async function configureVaultFolders(vaultPath: string): Promise<void> {
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.inbox, FOLDERS.inbox)
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.notes, FOLDERS.notes)

  await moveFirstAliasToCanonical(vaultPath, FOLDERS.journal, JOURNAL_FOLDER_ALIASES)
  await moveFirstAliasToCanonical(vaultPath, FOLDERS.templates, TEMPLATES_FOLDER_ALIASES)
  await moveFirstAliasToCanonical(vaultPath, FOLDERS.attachments, ATTACHMENTS_FOLDER_ALIASES)

  for (const agentFolder of LEGACY_AGENT_FOLDER_ALIASES) {
    await removeManagedAgentFolderIfSafe(vaultPath, agentFolder)
  }

  await mkdir(join(vaultPath, FOLDERS.inbox), { recursive: true })
  await mkdir(join(vaultPath, FOLDERS.notes), { recursive: true })
  await mkdir(join(vaultPath, FOLDERS.journal), { recursive: true })
  await mkdir(join(vaultPath, FOLDERS.templates), { recursive: true })
  await mkdir(join(vaultPath, FOLDERS.attachments), { recursive: true })
}
