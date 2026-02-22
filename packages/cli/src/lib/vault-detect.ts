import { join } from "node:path"

import { readOpenClawConfigFile, readOpenClawExtraPaths } from "./openclaw-config"
import { resolveUserPath } from "./paths"
import { isDirectory } from "./vault-fs"

export async function detectExistingFolder(
  vaultPath: string,
  candidates: readonly string[],
): Promise<string | undefined> {
  for (const folder of candidates) {
    if (await isDirectory(join(vaultPath, folder))) {
      return folder
    }
  }

  return undefined
}

export async function looksLikeZettelclawVault(
  vaultPath: string,
  notesFolderCandidates: readonly string[],
  journalFolderCandidates: readonly string[],
): Promise<boolean> {
  if (!(await isDirectory(vaultPath))) {
    return false
  }

  const notesFolder = await detectExistingFolder(vaultPath, notesFolderCandidates)
  const journalFolder = await detectExistingFolder(vaultPath, journalFolderCandidates)
  return typeof notesFolder === "string" && typeof journalFolder === "string"
}

export async function detectVaultFromOpenClawConfig(
  configPath: string,
  notesFolderCandidates: readonly string[],
  journalFolderCandidates: readonly string[],
): Promise<string | undefined> {
  const loaded = await readOpenClawConfigFile(configPath)
  if (!loaded.config) {
    return undefined
  }

  for (const candidate of readOpenClawExtraPaths(loaded.config)) {
    const resolvedCandidate = resolveUserPath(candidate)
    if (await looksLikeZettelclawVault(resolvedCandidate, notesFolderCandidates, journalFolderCandidates)) {
      return resolvedCandidate
    }
  }

  return undefined
}
