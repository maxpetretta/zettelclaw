import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { pathExists } from "./vault"

const HOOK_SOURCE_DIR = resolve(import.meta.dir, "..", "..", "hooks", "zettelclaw")

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord
  }

  return {}
}

function coerceHookEntry(value: unknown): JsonRecord {
  if (typeof value === "boolean") {
    return { enabled: value }
  }

  return asRecord(value)
}

export async function installOpenClawHook(openclawDir: string): Promise<"installed" | "skipped" | "failed"> {
  const hookPath = join(openclawDir, "hooks", "zettelclaw")

  try {
    if (await pathExists(hookPath)) {
      return "skipped"
    }

    if (!(await pathExists(HOOK_SOURCE_DIR))) {
      return "failed"
    }

    await mkdir(dirname(hookPath), { recursive: true })
    await cp(HOOK_SOURCE_DIR, hookPath, { recursive: true })
    return "installed"
  } catch {
    return "failed"
  }
}

export async function patchOpenClawConfig(vaultPath: string, openclawDir: string): Promise<boolean> {
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
      return false
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
    return true
  } catch {
    return false
  }
}

/**
 * Fire a system event to tell the running OpenClaw agent to update
 * AGENTS.md and HEARTBEAT.md with Zettelclaw-aware content.
 *
 * Uses `openclaw system event` CLI. Returns true if the event was sent.
 */
export async function firePostInitEvent(vaultPath: string, projectPath: string): Promise<boolean> {
  const { spawnSync } = await import("node:child_process")

  // Read the post-init event template
  const templatePath = join(projectPath, "templates", "post-init-event.md")
  let template: string
  try {
    template = await readFile(templatePath, "utf8")
  } catch {
    console.warn("[zettelclaw] Could not read post-init event template")
    return false
  }

  // Substitute variables
  const eventText = template.replaceAll("{{VAULT_PATH}}", vaultPath).replaceAll("{{PROJECT_PATH}}", projectPath)

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
      console.warn("[zettelclaw] Could not fire post-init system event (is the gateway running?)")
      return false
    }
  }

  return true
}
