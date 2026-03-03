import { readFile } from "node:fs/promises"

import { asRecord, asStringArray, type JsonRecord } from "./json"
import { pathExists } from "./vault-fs"

export interface ReadConfigResult {
  config?: JsonRecord
  error?: string
}

export async function readOpenClawConfigFile(configPath: string): Promise<ReadConfigResult> {
  if (!(await pathExists(configPath))) {
    return { error: `OpenClaw config not found at ${configPath}` }
  }

  let raw = ""
  try {
    raw = await readFile(configPath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: `Could not read ${configPath}: ${message}` }
  }

  const parsed = parseOpenClawConfig(raw)
  if (!parsed) {
    return { error: `Could not parse JSON in ${configPath}` }
  }

  return { config: parsed }
}

export function parseOpenClawConfig(raw: string): JsonRecord | undefined {
  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export function readOpenClawExtraPathsByScope(config: JsonRecord): { global: string[]; defaults: string[] } {
  const directMemorySearch = asRecord(config.memorySearch)
  const agents = asRecord(config.agents)
  const defaults = asRecord(agents.defaults)
  const defaultsMemorySearch = asRecord(defaults.memorySearch)

  return {
    global: asStringArray(directMemorySearch.extraPaths),
    defaults: asStringArray(defaultsMemorySearch.extraPaths),
  }
}

export function readOpenClawExtraPaths(config: JsonRecord): string[] {
  const scopedPaths = readOpenClawExtraPathsByScope(config)
  return [...scopedPaths.global, ...scopedPaths.defaults]
}

export function readHookEnabled(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value
  }

  const record = asRecord(value)
  return typeof record.enabled === "boolean" ? record.enabled : undefined
}
