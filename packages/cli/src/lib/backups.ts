import { basename, dirname, join } from "node:path"

import { pathExists } from "./vault-fs"

const DEFAULT_MAX_ATTEMPTS = 10_000

async function chooseNumberedBackupPath(
  directoryPath: string,
  baseLabel: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<{ backupPath: string; label: string }> {
  for (let index = 0; index < maxAttempts; index += 1) {
    const label = index === 0 ? baseLabel : `${baseLabel}.${index}`
    const backupPath = join(directoryPath, label)

    if (!(await pathExists(backupPath))) {
      return { backupPath, label }
    }
  }

  throw new Error(`Could not find an available backup path under ${directoryPath} after ${maxAttempts} attempts`)
}

export function chooseFileBackupPath(sourcePath: string): Promise<{ backupPath: string; label: string }> {
  const sourceName = basename(sourcePath)
  return chooseNumberedBackupPath(dirname(sourcePath), `${sourceName}.bak`)
}

export function chooseDirectoryBackupPath(
  parentDirectory: string,
  sourceName: string,
): Promise<{ backupPath: string; label: string }> {
  return chooseNumberedBackupPath(parentDirectory, `${sourceName}.bak`)
}
