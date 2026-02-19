#!/usr/bin/env bun

import { log } from "@clack/prompts";

import { runInit } from "./commands/init";
import { runUpgrade } from "./commands/upgrade";

interface ParsedArgs {
  command?: string;
  flags: {
    openclaw: boolean;
    yes: boolean;
    vaultPath?: string;
    root: boolean;
    minimal: boolean;
    noOpenclaw: boolean;
    workspacePath?: string;
    initGit?: boolean;
  };
}

function usage(): string {
  return [
    "zettelclaw",
    "",
    "Commands:",
    "  zettelclaw init [--yes] [--vault <path>] [--workspace <path>] [--root] [--minimal] [--no-git] [--no-openclaw] [--openclaw]",
    "  zettelclaw upgrade [--yes] [--vault <path>]",
    "",
    "Flags:",
    "  --root          Use vault root for new notes",
    "  --minimal       Install Minimal theme and companion plugins",
    "  --no-git        Skip git initialization",
    "  --no-openclaw   Skip OpenClaw workspace detection/injection",
    "  --openclaw      Backward-compatible no-op",
  ].join("\n");
}

function takeValue(args: string[], index: number, key: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${key}`);
  }

  return value;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , command, ...rest] = argv;

  const parsed: ParsedArgs = {
    command,
    flags: {
      openclaw: false,
      yes: false,
      root: false,
      minimal: false,
      noOpenclaw: false,
      initGit: true,
    },
  };

  if (command === "--help" || command === "-h") {
    parsed.command = "help";
    return parsed;
  }

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.command = "help";
      continue;
    }

    if (arg === "--openclaw") {
      parsed.flags.openclaw = true;
      continue;
    }

    if (arg === "--yes") {
      parsed.flags.yes = true;
      continue;
    }

    if (arg === "--root") {
      parsed.flags.root = true;
      continue;
    }

    if (arg === "--minimal") {
      parsed.flags.minimal = true;
      continue;
    }

    if (arg === "--git") {
      parsed.flags.initGit = true;
      continue;
    }

    if (arg === "--no-git") {
      parsed.flags.initGit = false;
      continue;
    }

    if (arg === "--no-openclaw") {
      parsed.flags.noOpenclaw = true;
      continue;
    }

    if (arg.startsWith("--vault=")) {
      parsed.flags.vaultPath = arg.slice("--vault=".length);
      continue;
    }

    if (arg === "--vault") {
      parsed.flags.vaultPath = takeValue(rest, index, "--vault");
      index += 1;
      continue;
    }

    if (arg.startsWith("--workspace=")) {
      parsed.flags.workspacePath = arg.slice("--workspace=".length);
      continue;
    }

    if (arg === "--workspace") {
      parsed.flags.workspacePath = takeValue(rest, index, "--workspace");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (!parsed.command || parsed.command === "help") {
    console.log(usage());
    return;
  }

  if (parsed.command === "init") {
    await runInit({
      openclaw: parsed.flags.openclaw,
      yes: parsed.flags.yes,
      vaultPath: parsed.flags.vaultPath,
      root: parsed.flags.root,
      minimal: parsed.flags.minimal,
      noOpenclaw: parsed.flags.noOpenclaw,
      workspacePath: parsed.flags.workspacePath,
      initGit: parsed.flags.initGit,
    });
    return;
  }

  if (parsed.command === "upgrade") {
    await runUpgrade({
      yes: parsed.flags.yes,
      vaultPath: parsed.flags.vaultPath,
    });
    return;
  }

  console.log(usage());
  throw new Error(`Unknown command: ${parsed.command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log.error(message);
  process.exit(1);
});
