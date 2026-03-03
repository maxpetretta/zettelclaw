#!/usr/bin/env bun

import { log } from "@clack/prompts"

import { runInit } from "./commands/init"
import { runInstallPlugins } from "./commands/install-plugins"
import { runVerify } from "./commands/verify"
import type { SyncMethod } from "./lib/vault-obsidian"

interface ParsedArgs {
  command: string | undefined
  flags: {
    yes: boolean
    vaultPath?: string | undefined
    minimal: boolean
    workspacePath?: string | undefined
    syncMethod?: SyncMethod | undefined
  }
}

type ParsedFlagKey = keyof ParsedArgs["flags"]

type OptionKind = "boolean" | "string"

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
  { longName: "--sync", flag: "syncMethod", kind: "string" },
]

const OPTION_SPEC_BY_LONG_NAME = new Map(OPTION_SPECS.map((spec) => [spec.longName, spec]))

function usage(): string {
  return [
    "🦞 Zettelclaw - Your agent's second brain, built together",
    "",
    "Usage:",
    "  zettelclaw init [options]     Install and configure a Zettelclaw vault",
    "  zettelclaw plugins [options]  Install or refresh bundled plugin binaries",
    "  zettelclaw verify [options]   Verify vault, plugin, and OpenClaw integration",
    "",
    "Options:",
    "  --vault <path>      Set vault path (default: ~/zettelclaw)",
    "  --workspace <path>  Override OpenClaw workspace path (default: ~/.openclaw/workspace)",
    "  --sync <method>     git | obsidian-sync | none (default: git)",
    "  --minimal           Install Minimal theme (+ minimal settings + hider)",
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

function normalizeSyncMethod(rawValue: string): SyncMethod {
  if (rawValue === "git" || rawValue === "obsidian-sync" || rawValue === "none") {
    return rawValue
  }

  throw new Error(`Invalid value for --sync: ${rawValue}. Expected git, obsidian-sync, or none.`)
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

  switch (spec.flag) {
    case "vaultPath":
      parsed.flags.vaultPath = rawValue
      return
    case "workspacePath":
      parsed.flags.workspacePath = rawValue
      return
    case "syncMethod":
      parsed.flags.syncMethod = normalizeSyncMethod(rawValue)
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
  if (parsed.command !== "init" && parsed.command !== "plugins" && parsed.command !== "verify") {
    return
  }

  if (parsed.command === "verify" && parsed.flags.syncMethod) {
    throw new Error("--sync is only supported with `zettelclaw init` and `zettelclaw plugins`")
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

    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`)
    }

    index += applyOption(parsed, rest, index)
  }

  validateArgs(parsed)
  return parsed
}

async function main() {
  const parsed = parseArgs(process.argv)

  if (parsed.command === "help" || !parsed.command) {
    console.log(usage())
    return
  }

  if (parsed.command === "init") {
    await runInit({
      yes: parsed.flags.yes,
      vaultPath: parsed.flags.vaultPath,
      minimal: parsed.flags.minimal,
      workspacePath: parsed.flags.workspacePath,
      syncMethod: parsed.flags.syncMethod,
    })
    return
  }

  if (parsed.command === "plugins") {
    await runInstallPlugins({
      yes: parsed.flags.yes,
      vaultPath: parsed.flags.vaultPath,
      minimal: parsed.flags.minimal,
      syncMethod: parsed.flags.syncMethod,
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

  log.error(`Unknown command: ${parsed.command}`)
  console.log(usage())
  process.exit(1)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  log.error(message)
  process.exit(1)
})
