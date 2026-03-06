import { spawn, spawnSync } from "node:child_process"
import { basename, join } from "node:path"

import { FOLDERS } from "./folders"

interface QmdCommandOptions {
  timeoutMs?: number
}

interface QmdCommandResult {
  ok: boolean
  status: number
  stdout: string
  stderr: string
  message?: string
  errorCode?: string
}

interface CollectionFolderSpec {
  suffix: string
  folder: string
}

export interface QmdCollectionSpec {
  name: string
  path: string
  mask: string
}

export interface EnsureQmdCollectionsResult {
  configured: string[]
  failed: string[]
  skipped: boolean
  missingBinary?: boolean
  message?: string
}

export interface ListQmdCollectionsResult {
  ok: boolean
  names: string[]
  missingBinary?: boolean
  message?: string
}

const MARKDOWN_MASK = "**/*.md"

const COLLECTION_FOLDERS: CollectionFolderSpec[] = [
  { suffix: "inbox", folder: FOLDERS.inbox },
  { suffix: "notes", folder: FOLDERS.notes },
  { suffix: "journal", folder: FOLDERS.journal },
]

function formatFailureMessage(args: string[], status: number, stderr: string, stdout: string): string {
  const trimmedStderr = stderr.trim()
  if (trimmedStderr.length > 0) {
    return trimmedStderr
  }

  const trimmedStdout = stdout.trim()
  if (trimmedStdout.length > 0) {
    return trimmedStdout
  }

  return `qmd ${args.join(" ")} exited with code ${status}`
}

function runQmdCommand(args: string[], options: QmdCommandOptions = {}): QmdCommandResult {
  return runCommand("qmd", args, options)
}

function toSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug.length > 0 ? slug : "vault"
}

function collectionPrefixForVault(vaultPath: string): string {
  return `zettelclaw-${toSlug(basename(vaultPath))}`
}

export function expectedQmdCollections(vaultPath: string): QmdCollectionSpec[] {
  const prefix = collectionPrefixForVault(vaultPath)

  return COLLECTION_FOLDERS.map((spec) => ({
    name: `${prefix}-${spec.suffix}`,
    path: join(vaultPath, spec.folder),
    mask: MARKDOWN_MASK,
  }))
}

function parseQmdCollectionNames(raw: string): string[] {
  const names: string[] = []

  for (const line of raw.split(/\r?\n/u)) {
    const match = line.match(/^(.+?)\s+\(qmd:\/\/.+\)$/u)
    if (match?.[1]) {
      names.push(match[1].trim())
    }
  }

  return names
}

function qmdMissingMessage(): string {
  return "qmd is not installed. Install it with `npm install -g @tobilu/qmd` (or `bun install -g @tobilu/qmd`) and rerun `zettelclaw init`."
}

export interface InstallQmdResult {
  installed: boolean
  command?: string
  message?: string
}

function runCommand(command: string, args: string[], options: QmdCommandOptions = {}): QmdCommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 120_000,
  })

  const stdout = result.stdout ?? ""
  const stderr = result.stderr ?? ""
  const status = result.status ?? 1

  if (result.error) {
    const maybeCode = "code" in result.error ? result.error.code : undefined
    const output: QmdCommandResult = {
      ok: false,
      status,
      stdout,
      stderr,
      message: result.error.message,
    }
    if (typeof maybeCode === "string") {
      output.errorCode = maybeCode
    }

    return output
  }

  if (status !== 0) {
    return {
      ok: false,
      status,
      stdout,
      stderr,
      message: formatFailureMessage(args, status, stderr, stdout),
    }
  }

  return {
    ok: true,
    status,
    stdout,
    stderr,
  }
}

async function runCommandAsync(
  command: string,
  args: string[],
  options: QmdCommandOptions = {},
): Promise<QmdCommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let settled = false
    const timeoutMs = options.timeoutMs ?? 120_000

    const finish = (result: QmdCommandResult) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk
    })

    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk
    })

    child.on("error", (error) => {
      const maybeCode = "code" in error ? error.code : undefined
      const result: QmdCommandResult = {
        ok: false,
        status: 1,
        stdout,
        stderr,
        message: error.message,
      }

      if (typeof maybeCode === "string") {
        result.errorCode = maybeCode
      }

      finish(result)
    })

    child.on("close", (status) => {
      const exitStatus = status ?? 1

      if (exitStatus !== 0) {
        finish({
          ok: false,
          status: exitStatus,
          stdout,
          stderr,
          message: formatFailureMessage(args, exitStatus, stderr, stdout),
        })
        return
      }

      finish({
        ok: true,
        status: exitStatus,
        stdout,
        stderr,
      })
    })

    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      finish({
        ok: false,
        status: 1,
        stdout,
        stderr,
        message: `${command} ${args.join(" ")} timed out after ${timeoutMs}ms`,
      })
    }, timeoutMs)
  })
}

export async function installQmdGlobal(): Promise<InstallQmdResult> {
  const installAttempts: Array<{ command: string; args: string[] }> = [
    { command: "bun", args: ["install", "-g", "@tobilu/qmd"] },
    { command: "npm", args: ["install", "-g", "@tobilu/qmd"] },
  ]
  const failures: string[] = []

  for (const attempt of installAttempts) {
    const availabilityCheck = runCommand(attempt.command, ["--version"], { timeoutMs: 10_000 })
    if (!availabilityCheck.ok && availabilityCheck.errorCode === "ENOENT") {
      continue
    }

    const install = await runCommandAsync(attempt.command, attempt.args, { timeoutMs: 300_000 })
    const commandLine = `${attempt.command} ${attempt.args.join(" ")}`

    if (install.ok) {
      return {
        installed: true,
        command: commandLine,
      }
    }

    failures.push(`${commandLine}: ${install.message ?? "failed"}`)
  }

  if (failures.length === 0) {
    return {
      installed: false,
      message: "Could not install QMD because neither `bun` nor `npm` was found on PATH.",
    }
  }

  return {
    installed: false,
    message: `Could not install QMD.\n${failures.map((line) => `- ${line}`).join("\n")}`,
  }
}

export function ensureQmdCollections(vaultPath: string): EnsureQmdCollectionsResult {
  const check = runQmdCommand(["--help"], { timeoutMs: 10_000 })
  if (!check.ok && check.errorCode === "ENOENT") {
    return {
      configured: [],
      failed: [],
      skipped: true,
      missingBinary: true,
      message: qmdMissingMessage(),
    }
  }

  if (!check.ok) {
    return {
      configured: [],
      failed: [],
      skipped: true,
      message: check.message ?? "Could not run qmd.",
    }
  }

  const configured: string[] = []
  const failed: string[] = []

  for (const collection of expectedQmdCollections(vaultPath)) {
    runQmdCommand(["collection", "remove", collection.name], { timeoutMs: 30_000 })

    const add = runQmdCommand(
      ["collection", "add", collection.path, "--name", collection.name, "--mask", collection.mask],
      { timeoutMs: 120_000 },
    )

    if (add.ok) {
      configured.push(collection.name)
    } else {
      failed.push(`${collection.name}: ${add.message ?? "failed to create collection"}`)
    }
  }

  return {
    configured,
    failed,
    skipped: false,
  }
}

export function listQmdCollections(): ListQmdCollectionsResult {
  const output = runQmdCommand(["collection", "list"], { timeoutMs: 20_000 })

  if (!output.ok && output.errorCode === "ENOENT") {
    return {
      ok: false,
      names: [],
      missingBinary: true,
      message: qmdMissingMessage(),
    }
  }

  if (!output.ok) {
    return {
      ok: false,
      names: [],
      message: output.message ?? "Could not list qmd collections.",
    }
  }

  return {
    ok: true,
    names: parseQmdCollectionNames(output.stdout),
  }
}
