import { homedir } from "node:os"
import { isCancel } from "@clack/prompts"

export const DEFAULT_OPENCLAW_WORKSPACE_PATH = "~/.openclaw/workspace"
export const DEFAULT_VAULT_PATH = "~/zettelclaw"

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
