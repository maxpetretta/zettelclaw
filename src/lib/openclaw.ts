import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { getVaultFolders, type NotesMode } from "./vault"

const AGENTS_MARKER = "zettelclaw-agents"
const MEMORY_MARKER = "zettelclaw-memory"
const HEARTBEAT_MARKER = "zettelclaw-heartbeat"
const HOOK_SOURCE_DIR = resolve(import.meta.dir, "..", "..", "hooks", "zettelclaw")

interface WorkspaceContext {
  vaultPath: string
  notesMode: NotesMode
  includeAgent: boolean
  symlinksEnabled: boolean
}

type JsonRecord = Record<string, unknown>

function section(marker: string, body: string): string {
  return [`<!-- ${marker}:start -->`, body.trimEnd(), `<!-- ${marker}:end -->`, ""].join("\n")
}

async function appendSectionIfMissing(path: string, marker: string, body: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true })

  let existing = ""
  try {
    existing = await readFile(path, "utf8")
  } catch {
    existing = ""
  }

  if (existing.includes(`<!-- ${marker}:start -->`)) {
    return false
  }

  const next = `${existing.trimEnd()}\n\n${section(marker, body)}`.trimStart()
  await writeFile(path, `${next}\n`, "utf8")
  return true
}

function agentsContent(context: WorkspaceContext): string {
  const folders = getVaultFolders(context.includeAgent)
  const notesLocation = context.notesMode === "notes" ? `\`${folders.notes}/\`` : "the vault root"

  return `
## Zettelclaw Vault Conventions

- Vault path: \`${context.vaultPath}\`
- Note location: ${notesLocation}
- Required frontmatter \`type\` values: \`note\`, \`journal\`, \`project\`, \`research\`, \`contact\`, \`writing\`
- Only \`project\` and \`research\` may use \`status\`.
- Always use title-case filenames, \`YYYY-MM-DD\` dates, and pluralized tags.
- Link aggressively with \`[[wikilinks]]\` and keep source provenance in \`source\` when possible.
- Do not create nested folders under ${notesLocation} (or the root note area in root mode).
- Triage \`${folders.inbox}/\` during heartbeat cycles and extract durable notes from workspace journals.
`
}

function memoryContent(context: WorkspaceContext): string {
  return `
## Zettelclaw Setup Context

- Vault path: \`${context.vaultPath}\`
- Notes mode: \`${context.notesMode}\`
- Agent symlinks enabled: \`${context.symlinksEnabled ? "yes" : "no"}\`
- Vault note types: \`note\`, \`journal\`, \`project\`, \`research\`, \`contact\`, \`writing\`
`
}

function heartbeatContent(): string {
  const folders = getVaultFolders(true)

  return `
## Zettelclaw Extraction Tasks

- Review recent workspace journals in \`memory/YYYY-MM-DD.md\` for extractable ideas.
- Convert durable insights into vault notes with complete frontmatter.
- Link new notes to relevant existing notes.
- Update project notes with progress logs and decisions.
- Triage \`${folders.inbox}/\` captures into proper notes or archive them.
- Surface notes that need missing links, sources, or summaries.
`
}

export function gatewayPatchSnippet(vaultPath: string): string {
  return ["memorySearch:", "  extraPaths:", `    - "${vaultPath}"`].join("\n")
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

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

    const memorySearch = asRecord(config.memorySearch)
    config.memorySearch = memorySearch

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

export async function appendWorkspaceIntegration(
  workspacePath: string,
  context: WorkspaceContext,
): Promise<{ added: string[]; skipped: string[] }> {
  const files = [
    { path: join(workspacePath, "AGENTS.md"), marker: AGENTS_MARKER, body: agentsContent(context) },
    { path: join(workspacePath, "MEMORY.md"), marker: MEMORY_MARKER, body: memoryContent(context) },
    { path: join(workspacePath, "HEARTBEAT.md"), marker: HEARTBEAT_MARKER, body: heartbeatContent() },
  ]

  const added: string[] = []
  const skipped: string[] = []

  for (const file of files) {
    const created = await appendSectionIfMissing(file.path, file.marker, file.body)
    if (created) {
      added.push(file.path)
    } else {
      skipped.push(file.path)
    }
  }

  return { added, skipped }
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
