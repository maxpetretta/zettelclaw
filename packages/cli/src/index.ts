#!/usr/bin/env bun

import { log } from "@clack/prompts"

import { runInit } from "./commands/init"
import { runMigrate } from "./commands/migrate"
import { runVerify } from "./commands/verify"

interface ParsedArgs {
  command: string | undefined
  flags: {
    yes: boolean
    vaultPath?: string | undefined
    minimal: boolean
    workspacePath?: string | undefined
    model?: string | undefined
    statePath?: string | undefined
    parallelJobs?: number | undefined
  }
}

function usage(): string {
  return [
    "zettelclaw — A human+agent knowledge system built on Obsidian and OpenClaw",
    "",
    "Usage:",
    "  zettelclaw init [options]     Set up a new Zettelclaw vault",
    "  zettelclaw migrate [options]  Migrate OpenClaw workspace memory into the vault",
    "  zettelclaw verify [options]   Verify Zettelclaw setup with local programmatic checks",
    "",
    "Init options:",
    "  --vault <path>      Set vault path (default: ~/zettelclaw)",
    "  --workspace <path>  Override OpenClaw workspace path (default: ~/.openclaw/workspace)",
    "  --yes               Accept all defaults non-interactively",
    "  --minimal           Install Minimal theme with Minimal Settings and Hider",
    "",
    "Migrate options:",
    "  --vault <path>      Vault path (auto-detected if not provided)",
    "  --workspace <path>  OpenClaw workspace path (default: ~/.openclaw/workspace)",
    "  --model <name>      Model alias/key for migration sub-agents",
    "  --state-path <path> Resume state file path (default: <workspace>/.zettelclaw/migrate-state.json)",
    "  --parallel-jobs <n> Number of concurrent sub-agent jobs (default: 5)",
    "  --yes               Accept defaults non-interactively",
    "",
    "Verify options:",
    "  --vault <path>      Vault path (auto-detected if not provided)",
    "  --workspace <path>  OpenClaw workspace path (default: ~/.openclaw/workspace)",
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

function parseInlineValue(arg: string, prefix: string, key: string): string {
  const value = arg.slice(prefix.length)
  if (value.length === 0) {
    throw new Error(`Missing value for ${key}`)
  }

  return value
}

function validateArgs(parsed: ParsedArgs): void {
  if (parsed.command !== "init" && parsed.command !== "migrate" && parsed.command !== "verify") {
    return
  }

  if (parsed.command !== "migrate" && parsed.flags.model) {
    throw new Error("--model is only supported with `zettelclaw migrate`")
  }

  if (parsed.command !== "migrate" && parsed.flags.statePath) {
    throw new Error("--state-path is only supported with `zettelclaw migrate`")
  }

  if (parsed.command !== "migrate" && typeof parsed.flags.parallelJobs === "number") {
    throw new Error("--parallel-jobs is only supported with `zettelclaw migrate`")
  }

  if (
    typeof parsed.flags.parallelJobs === "number" &&
    (!Number.isFinite(parsed.flags.parallelJobs) || parsed.flags.parallelJobs < 1)
  ) {
    throw new Error("--parallel-jobs must be a positive integer")
  }

  if (parsed.command !== "init" && parsed.flags.minimal) {
    throw new Error("--minimal is only supported with `zettelclaw init`")
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , command, ...rest] = argv

  const parsed: ParsedArgs = {
    command,
    flags: {
      yes: false,
      minimal: false,
    },
  }

  if (command === "--help" || command === "-h" || command === "help") {
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
      return parsed
    }

    if (arg === "--yes") {
      parsed.flags.yes = true
      continue
    }

    if (arg === "--minimal") {
      parsed.flags.minimal = true
      continue
    }

    if (arg.startsWith("--vault=")) {
      parsed.flags.vaultPath = parseInlineValue(arg, "--vault=", "--vault")
      continue
    }

    if (arg === "--vault") {
      parsed.flags.vaultPath = takeValue(rest, index, "--vault")
      index += 1
      continue
    }

    if (arg.startsWith("--workspace=")) {
      parsed.flags.workspacePath = parseInlineValue(arg, "--workspace=", "--workspace")
      continue
    }

    if (arg === "--workspace") {
      parsed.flags.workspacePath = takeValue(rest, index, "--workspace")
      index += 1
      continue
    }

    if (arg.startsWith("--model=")) {
      parsed.flags.model = parseInlineValue(arg, "--model=", "--model")
      continue
    }

    if (arg === "--model") {
      parsed.flags.model = takeValue(rest, index, "--model")
      index += 1
      continue
    }

    if (arg.startsWith("--state-path=")) {
      parsed.flags.statePath = parseInlineValue(arg, "--state-path=", "--state-path")
      continue
    }

    if (arg === "--state-path") {
      parsed.flags.statePath = takeValue(rest, index, "--state-path")
      index += 1
      continue
    }

    if (arg.startsWith("--parallel-jobs=")) {
      const raw = parseInlineValue(arg, "--parallel-jobs=", "--parallel-jobs")
      const parsedValue = Number.parseInt(raw, 10)
      if (Number.isNaN(parsedValue)) {
        throw new Error(`Invalid value for --parallel-jobs: ${raw}`)
      }
      parsed.flags.parallelJobs = parsedValue
      continue
    }

    if (arg === "--parallel-jobs") {
      const raw = takeValue(rest, index, "--parallel-jobs")
      const parsedValue = Number.parseInt(raw, 10)
      if (Number.isNaN(parsedValue)) {
        throw new Error(`Invalid value for --parallel-jobs: ${raw}`)
      }
      parsed.flags.parallelJobs = parsedValue
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  validateArgs(parsed)
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
      vaultPath: parsed.flags.vaultPath,
      workspacePath: parsed.flags.workspacePath,
      model: parsed.flags.model,
      statePath: parsed.flags.statePath,
      parallelJobs: parsed.flags.parallelJobs,
    })
    return
  }

  if (parsed.command === "verify") {
    await runVerify({
      yes: parsed.flags.yes,
      vaultPath: parsed.flags.vaultPath,
      workspacePath: parsed.flags.workspacePath,
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
