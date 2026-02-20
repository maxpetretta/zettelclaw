#!/usr/bin/env bun

import { log } from "@clack/prompts"

import { runInit } from "./commands/init"
import { runMigrate } from "./commands/migrate"

interface ParsedArgs {
  command?: string | undefined
  flags: {
    openclaw: boolean
    yes: boolean
    vaultPath?: string | undefined
    minimal: boolean
    workspacePath?: string | undefined
    model?: string | undefined
    dryRun: boolean
  }
}

function usage(): string {
  return [
    "zettelclaw — A human+agent knowledge system built on Obsidian and OpenClaw",
    "",
    "Usage:",
    "  zettelclaw init [options]     Set up a new Zettelclaw vault",
    "  zettelclaw migrate [options]  Migrate OpenClaw workspace memory into the vault",
    "",
    "Init options:",
    "  --vault <path>      Set vault path (default: current directory)",
    "  --workspace <path>  Override OpenClaw workspace path (default: ~/.openclaw/workspace)",
    "  --openclaw          Force OpenClaw integration and hook setup",
    "  --yes               Accept all defaults non-interactively",
    "  --minimal           Install Minimal theme with Minimal Settings and Hider",
    "",
    "Migrate options:",
    "  --vault <path>      Vault path (auto-detected if not provided)",
    "  --workspace <path>  OpenClaw workspace path (default: ~/.openclaw/workspace)",
    "  --model <name>      Model alias/key for migration sub-agents",
    "  --dry-run           Run prompts but don't start migration",
    "  --yes               Accept defaults non-interactively",
  ].join("\n")
}

function takeValue(args: string[], index: number, key: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${key}`)
  }

  return value
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , command, ...rest] = argv

  const parsed: ParsedArgs = {
    command,
    flags: {
      openclaw: false,
      yes: false,
      minimal: false,
      dryRun: false,
    },
  }

  if (command === "--help" || command === "-h") {
    parsed.command = "help"
    return parsed
  }

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg) {
      continue
    }

    if (arg === "--help" || arg === "-h") {
      parsed.command = "help"
      continue
    }

    if (arg === "--openclaw") {
      parsed.flags.openclaw = true
      continue
    }

    if (arg === "--yes") {
      parsed.flags.yes = true
      continue
    }

    if (arg === "--root") {
      // deprecated, ignored
      continue
    }

    if (arg === "--minimal") {
      parsed.flags.minimal = true
      continue
    }

    if (arg === "--no-openclaw") {
      // deprecated, ignored
      continue
    }

    if (arg.startsWith("--vault=")) {
      parsed.flags.vaultPath = arg.slice("--vault=".length)
      continue
    }

    if (arg === "--vault") {
      parsed.flags.vaultPath = takeValue(rest, index, "--vault")
      index += 1
      continue
    }

    if (arg.startsWith("--workspace=")) {
      parsed.flags.workspacePath = arg.slice("--workspace=".length)
      continue
    }

    if (arg === "--workspace") {
      parsed.flags.workspacePath = takeValue(rest, index, "--workspace")
      index += 1
      continue
    }

    if (arg.startsWith("--model=")) {
      parsed.flags.model = arg.slice("--model=".length)
      continue
    }

    if (arg === "--model") {
      parsed.flags.model = takeValue(rest, index, "--model")
      index += 1
      continue
    }

    if (arg === "--dry-run") {
      parsed.flags.dryRun = true
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return parsed
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv)

  if (!parsed.command || parsed.command === "help") {
    console.log(usage())
    return
  }

  if (parsed.command === "init") {
    await runInit({
      openclaw: parsed.flags.openclaw,
      yes: parsed.flags.yes,
      vaultPath: parsed.flags.vaultPath,
      minimal: parsed.flags.minimal,
      workspacePath: parsed.flags.workspacePath,
    })
    return
  }

  if (parsed.command === "migrate") {
    await runMigrate({
      yes: parsed.flags.yes,
      dryRun: parsed.flags.dryRun,
      vaultPath: parsed.flags.vaultPath,
      workspacePath: parsed.flags.workspacePath,
      model: parsed.flags.model,
    })
    return
  }

  console.log(usage())
  throw new Error(`Unknown command: ${parsed.command}`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  log.error(message)
  process.exit(1)
})
