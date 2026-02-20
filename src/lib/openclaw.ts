import { spawnSync } from "node:child_process"
import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { asRecord, type JsonRecord } from "./json"
import { substituteTemplate } from "./template"
import { pathExists } from "./vault"

const HOOK_SOURCE_DIR = resolve(import.meta.dirname, "..", "..", "hooks", "zettelclaw")

function coerceHookEntry(value: unknown): JsonRecord {
  if (typeof value === "boolean") {
    return { enabled: value }
  }

  return asRecord(value)
}

export interface HookInstallResult {
  status: "installed" | "skipped" | "failed"
  message?: string
}

export async function installOpenClawHook(openclawDir: string): Promise<HookInstallResult> {
  const hookPath = join(openclawDir, "hooks", "zettelclaw")

  try {
    if (await pathExists(hookPath)) {
      return { status: "skipped" }
    }

    if (!(await pathExists(HOOK_SOURCE_DIR))) {
      return { status: "failed", message: `Missing bundled hook at ${HOOK_SOURCE_DIR}` }
    }

    await mkdir(dirname(hookPath), { recursive: true })
    await cp(HOOK_SOURCE_DIR, hookPath, { recursive: true })
    return { status: "installed" }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: "failed", message: `Could not install hook to ${hookPath}: ${message}` }
  }
}

export interface ConfigPatchResult {
  changed: boolean
  message?: string
}

export async function patchOpenClawConfig(vaultPath: string, openclawDir: string): Promise<ConfigPatchResult> {
  const configPath = join(openclawDir, "openclaw.json")

  try {
    const raw = await readFile(configPath, "utf8")
    const config = asRecord(JSON.parse(raw))
    let changed = false

    const agents = asRecord(config.agents)
    config.agents = agents
    const defaults = asRecord(agents.defaults)
    agents.defaults = defaults
    const memorySearch = asRecord(defaults.memorySearch)
    defaults.memorySearch = memorySearch

    const extraPaths = Array.isArray(memorySearch.extraPaths) ? [...memorySearch.extraPaths] : []
    memorySearch.extraPaths = extraPaths

    if (!extraPaths.includes(vaultPath)) {
      extraPaths.push(vaultPath)
      changed = true
    }

    const hooks = asRecord(config.hooks)
    config.hooks = hooks

    const internal = asRecord(hooks.internal)
    hooks.internal = internal

    if (internal.enabled !== true) {
      internal.enabled = true
      changed = true
    }

    const entries = asRecord(internal.entries)
    internal.entries = entries

    const zettelclawEntry = coerceHookEntry(entries.zettelclaw)
    entries.zettelclaw = zettelclawEntry
    if (zettelclawEntry.enabled !== true) {
      zettelclawEntry.enabled = true
      changed = true
    }

    const sessionMemoryEntry = coerceHookEntry(entries["session-memory"])
    entries["session-memory"] = sessionMemoryEntry
    if (sessionMemoryEntry.enabled !== false) {
      sessionMemoryEntry.enabled = false
      changed = true
    }

    if (!changed) {
      return { changed: false }
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
    return { changed: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { changed: false, message: `Could not patch ${configPath}: ${message}` }
  }
}

/**
 * Fire a system event to tell the running OpenClaw agent to update
 * AGENTS.md and HEARTBEAT.md with Zettelclaw-aware content.
 *
 * Uses `openclaw system event` CLI. Returns true if the event was sent.
 */
export interface EventFireResult {
  sent: boolean
  message?: string
}

export async function firePostInitEvent(vaultPath: string, projectPath: string): Promise<EventFireResult> {
  // Read the post-init event template
  const templatePath = join(projectPath, "templates", "post-init-event.md")
  let template: string
  try {
    template = await readFile(templatePath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { sent: false, message: `Could not read template ${templatePath}: ${message}` }
  }

  // Substitute variables
  const eventText = substituteTemplate(template, {
    VAULT_PATH: vaultPath,
    PROJECT_PATH: projectPath,
  })

  // Fire the system event via OpenClaw CLI
  const result = spawnSync("openclaw", ["system", "event", "--text", eventText, "--mode", "now"], {
    encoding: "utf8",
    timeout: 10_000,
  })

  if (result.error || result.status !== 0) {
    // Try the cron wake approach as fallback
    const fallback = spawnSync("openclaw", ["system", "event", "--text", eventText], {
      encoding: "utf8",
      timeout: 10_000,
    })

    if (fallback.error || fallback.status !== 0) {
      const errorMessage =
        fallback.error?.message ??
        fallback.stderr?.trim() ??
        result.error?.message ??
        result.stderr?.trim() ??
        "unknown error"
      return { sent: false, message: `Could not fire post-init event via OpenClaw CLI: ${errorMessage}` }
    }
  }

  return { sent: true }
}
