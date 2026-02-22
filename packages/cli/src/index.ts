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

type ParsedFlagKey = keyof ParsedArgs["flags"]

type OptionKind = "boolean" | "string" | "integer"

interface OptionSpec {
  longName: string
  flag: ParsedFlagKey
  kind: OptionKind
}

const OPTION_SPECS: readonly OptionSpec[] = [
  { longName: "--yes", flag: "yes", kind: "boolean" },
  { longName: "--minimal", flag: "minimal", kind: "boolean" },
  { longName: "--vault", flag: "vaultPath", kind: "string" },
  { longName: "--workspace", flag: "workspacePath", kind: "string" },
  { longName: "--model", flag: "model", kind: "string" },
  { longName: "--state-path", flag: "statePath", kind: "string" },
  { longName: "--parallel-jobs", flag: "parallelJobs", kind: "integer" },
]

const OPTION_SPEC_BY_LONG_NAME = new Map(OPTION_SPECS.map((spec) => [spec.longName, spec]))

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

function parseIntegerValue(raw: string, key: string): number {
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`Invalid value for ${key}: ${raw}`)
  }

  const parsedValue = Number(raw)
  if (!Number.isSafeInteger(parsedValue)) {
    throw new Error(`Invalid value for ${key}: ${raw}`)
  }

  return parsedValue
}

function parseOptionToken(arg: string): { longName: string; inlineValue?: string } {
  const splitIndex = arg.indexOf("=")
  if (splitIndex < 0) {
    return { longName: arg }
  }

  return {
    longName: arg.slice(0, splitIndex),
    inlineValue: arg.slice(splitIndex + 1),
  }
}

function assignParsedFlag(parsed: ParsedArgs, spec: OptionSpec, rawValue?: string): void {
  if (spec.kind === "boolean") {
    if (rawValue !== undefined) {
      throw new Error(`Unknown argument: ${spec.longName}=${rawValue}`)
    }

    if (spec.flag === "yes" || spec.flag === "minimal") {
      parsed.flags[spec.flag] = true
      return
    }

    throw new Error(`Unsupported boolean option mapping for ${spec.longName}`)
  }

  if (typeof rawValue !== "string") {
    throw new Error(`Missing value for ${spec.longName}`)
  }

  if (rawValue.length === 0) {
    throw new Error(`Missing value for ${spec.longName}`)
  }

  const value = spec.kind === "integer" ? parseIntegerValue(rawValue, spec.longName) : rawValue

  switch (spec.flag) {
    case "vaultPath":
      parsed.flags.vaultPath = value as string
      return
    case "workspacePath":
      parsed.flags.workspacePath = value as string
      return
    case "model":
      parsed.flags.model = value as string
      return
    case "statePath":
      parsed.flags.statePath = value as string
      return
    case "parallelJobs":
      parsed.flags.parallelJobs = value as number
      return
    default:
      throw new Error(`Unsupported value option mapping for ${spec.longName}`)
  }
}

function applyOption(parsed: ParsedArgs, rest: string[], index: number): number {
  const arg = rest[index]
  if (!arg) {
    return 0
  }

  const token = parseOptionToken(arg)
  const spec = OPTION_SPEC_BY_LONG_NAME.get(token.longName)

  if (!spec) {
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (spec.kind === "boolean") {
    assignParsedFlag(parsed, spec, token.inlineValue)
    return 0
  }

  const rawValue = token.inlineValue ?? takeValue(rest, index, spec.longName)
  assignParsedFlag(parsed, spec, rawValue)

  return token.inlineValue === undefined ? 1 : 0
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

    const consumed = applyOption(parsed, rest, index)
    index += consumed
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
