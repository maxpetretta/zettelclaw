import { homedir } from "node:os"
import { isCancel } from "@clack/prompts"

export const CLI_TAGLINE = "An Obsidian vault your agent can actually read."
export const DEFAULT_OPENCLAW_WORKSPACE_PATH = "~/.openclaw/workspace"
export const DEFAULT_VAULT_PATH = "~/zettelclaw"
export type ThemePreset = "minimal" | "obsidian"

export function unwrapPrompt<T>(value: T | symbol): T {
  if (isCancel(value)) {
    process.exit(0)
  }

  return value as T
}

export function toTildePath(path: string): string {
  const home = homedir()
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

export function formatCommandIntro(action: string): string {
  return `🦞 ${CLI_TAGLINE}\nZettelclaw · ${action}`
}
