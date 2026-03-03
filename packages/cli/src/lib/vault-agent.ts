import { lstat, mkdir, readdir, readlink, rename, symlink } from "node:fs/promises"
import { join } from "node:path"

import {
  AGENT_FOLDER_ALIASES,
  FOLDERS_WITH_AGENT,
  FOLDERS_WITHOUT_AGENT,
  JOURNAL_FOLDER_ALIASES,
  LEGACY_FOLDERS,
} from "./folders"
import { pathExists, removePathIfExists } from "./vault-fs"
import type { CopyResult } from "./vault-seed"

const AGENT_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "MEMORY.md"] as const

function isSymlinkPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === "EPERM" || code === "EACCES" || code === "ENOTSUP"
}

export async function createAgentSymlinks(vaultPath: string, workspacePath: string): Promise<CopyResult> {
  const agentFolder = FOLDERS_WITH_AGENT.agent
  const agentDir = join(vaultPath, agentFolder)
  await mkdir(agentDir, { recursive: true })

  const result: CopyResult = {
    added: [],
    skipped: [],
    failed: [],
  }

  for (const file of AGENT_FILES) {
    const linkPath = join(agentDir, file)
    const targetPath = join(workspacePath, file)
    const relativePath = `${agentFolder}/${file}`

    let existingStats: Awaited<ReturnType<typeof lstat>> | null = null
    try {
      existingStats = await lstat(linkPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        throw new Error(
          `Could not inspect existing link ${linkPath}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    if (existingStats) {
      if (existingStats.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath)
        if (existingTarget === targetPath) {
          result.skipped.push(relativePath)
          continue
        }
      }

      result.skipped.push(relativePath)
      continue
    }

    try {
      await symlink(targetPath, linkPath)
      result.added.push(relativePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "EEXIST") {
        result.skipped.push(relativePath)
        continue
      }

      if (isSymlinkPermissionError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        result.failed.push(`${relativePath}: ${message}`)
        continue
      }

      throw new Error(
        `Could not create symlink ${linkPath} -> ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  await removePathIfExists(join(agentDir, ".gitkeep"))

  return result
}

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

export async function configureAgentFolder(vaultPath: string, enabled: boolean): Promise<void> {
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.inbox, FOLDERS_WITH_AGENT.inbox)
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.notes, FOLDERS_WITH_AGENT.notes)

  if (enabled) {
    await moveFirstAliasToCanonical(vaultPath, FOLDERS_WITH_AGENT.journal, JOURNAL_FOLDER_ALIASES)
    await moveFirstAliasToCanonical(vaultPath, FOLDERS_WITH_AGENT.agent, AGENT_FOLDER_ALIASES)
    await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.templates, FOLDERS_WITH_AGENT.templates)
    await moveFolderIfPossible(vaultPath, FOLDERS_WITHOUT_AGENT.templates, FOLDERS_WITH_AGENT.templates)
    await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.attachments, FOLDERS_WITH_AGENT.attachments)
    await moveFolderIfPossible(vaultPath, FOLDERS_WITHOUT_AGENT.attachments, FOLDERS_WITH_AGENT.attachments)
    await mkdir(join(vaultPath, FOLDERS_WITH_AGENT.agent), { recursive: true })
    return
  }

  for (const agentFolder of AGENT_FOLDER_ALIASES) {
    await removeManagedAgentFolderIfSafe(vaultPath, agentFolder)
  }

  await moveFirstAliasToCanonical(vaultPath, FOLDERS_WITHOUT_AGENT.journal, JOURNAL_FOLDER_ALIASES)
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.templates, FOLDERS_WITHOUT_AGENT.templates)
  await moveFolderIfPossible(vaultPath, FOLDERS_WITH_AGENT.templates, FOLDERS_WITHOUT_AGENT.templates)
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.attachments, FOLDERS_WITHOUT_AGENT.attachments)
  await moveFolderIfPossible(vaultPath, FOLDERS_WITH_AGENT.attachments, FOLDERS_WITHOUT_AGENT.attachments)
}
