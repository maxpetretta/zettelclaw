#!/usr/bin/env bun

import { parseArgs } from "node:util"
import { log } from "@clack/prompts"

import { runInit } from "./commands/init"
import { runVerify } from "./commands/verify"
import { CLI_TAGLINE, type ThemePreset } from "./lib/cli"
import type { SyncMethod } from "./lib/vault-obsidian"

function usage(): string {
  return [
    `🦞 Zettelclaw - ${CLI_TAGLINE}`,
    "Zettelclaw CLI",
    "",
    "Usage:",
    "  zettelclaw init [options]     Install and configure a Zettelclaw vault",
    "  zettelclaw verify [options]   Verify vault, plugin, and OpenClaw integration",
    "",
    "Options:",
    "  --vault <path>      Set vault path (default: ~/zettelclaw)",
    "  --workspace <path>  Override OpenClaw workspace path (default: ~/.openclaw/workspace)",
    "  --sync <method>     git | obsidian-sync | none (default: git)",
    "  --theme <preset>    minimal | obsidian",
    "  --yes               Accept defaults non-interactively",
  ].join("\n")
}

function validateSyncMethod(value: string | undefined): SyncMethod | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === "git" || value === "obsidian-sync" || value === "none") {
    return value
  }
  throw new Error(`Invalid value for --sync: ${value}. Expected git, obsidian-sync, or none.`)
}

function validateThemePreset(value: string | undefined): ThemePreset | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === "minimal" || value === "obsidian") {
    return value
  }
  throw new Error(`Invalid value for --theme: ${value}. Expected minimal or obsidian.`)
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      yes: { type: "boolean", default: false },
      vault: { type: "string" },
      workspace: { type: "string" },
      sync: { type: "string" },
      theme: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  })

  const command = positionals[0]

  if (values.help || command === "help" || !command) {
    console.log(usage())
    return
  }

  const syncMethod = validateSyncMethod(values.sync)
  const theme = validateThemePreset(values.theme)

  if (command === "init") {
    await runInit({
      yes: values.yes ?? false,
      vaultPath: values.vault,
      theme,
      workspacePath: values.workspace,
      syncMethod,
    })
    return
  }

  if (command === "verify") {
    if (syncMethod) {
      throw new Error("--sync is only supported with `zettelclaw init`")
    }
    if (theme) {
      throw new Error("--theme is only supported with `zettelclaw init`")
    }
    await runVerify({
      yes: values.yes ?? false,
      vaultPath: values.vault,
      workspacePath: values.workspace,
    })
    return
  }

  log.error(`Unknown command: ${command}`)
  console.log(usage())
  process.exit(1)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  log.error(message)
  process.exit(1)
})
