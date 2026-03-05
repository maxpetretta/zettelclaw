import { readFile, writeFile } from "node:fs/promises"

import { asRecord } from "./json"
import { pathExists } from "./vault-fs"

export interface EnsureMemoryPathResult {
  changed: boolean
  message?: string
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === "string")
}

function addUniquePath(paths: string[], candidatePath: string): boolean {
  if (paths.includes(candidatePath)) {
    return false
  }

  paths.push(candidatePath)
  return true
}

export async function ensureOpenClawMemoryPath(vaultPath: string, configPath: string): Promise<EnsureMemoryPathResult> {
  if (!(await pathExists(configPath))) {
    return {
      changed: false,
      message: `OpenClaw config not found at ${configPath}`,
    }
  }

  let raw = ""
  try {
    raw = await readFile(configPath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      changed: false,
      message: `Could not read ${configPath}: ${message}`,
    }
  }

  let changed = false
  try {
    const config = asRecord(JSON.parse(raw))
    const legacyMemorySearch = asRecord(config.memorySearch)

    const agents = asRecord(config.agents)
    config.agents = agents

    const defaults = asRecord(agents.defaults)
    agents.defaults = defaults

    const defaultsMemorySearch = asRecord(defaults.memorySearch)
    defaults.memorySearch = defaultsMemorySearch

    const defaultExtraPaths = ensureStringArray(defaultsMemorySearch.extraPaths)
    defaultsMemorySearch.extraPaths = defaultExtraPaths

    const legacyExtraPaths = ensureStringArray(legacyMemorySearch.extraPaths)
    for (const legacyPath of legacyExtraPaths) {
      if (addUniquePath(defaultExtraPaths, legacyPath)) {
        changed = true
      }
    }

    if (addUniquePath(defaultExtraPaths, vaultPath)) {
      changed = true
    }

    if ("memorySearch" in config) {
      config.memorySearch = undefined
      changed = true
    }

    if (!changed) {
      return { changed: false }
    }

    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
    return { changed: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      changed: false,
      message: `Could not patch ${configPath}: ${message}`,
    }
  }
}
