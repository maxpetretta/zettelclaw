import { isCancel } from "@clack/prompts"

export const DEFAULT_OPENCLAW_WORKSPACE_PATH = "~/.openclaw/workspace"

export function unwrapPrompt<T>(value: T | symbol): T {
  if (isCancel(value)) {
    process.exit(0)
  }

  return value as T
}

export function toTildePath(path: string): string {
  const home = process.env.HOME ?? ""
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}
