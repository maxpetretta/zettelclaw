import { spawnSync } from "node:child_process"
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
  message?: string
}

export interface ListQmdCollectionsResult {
  ok: boolean
  names: string[]
  message?: string
}

const MARKDOWN_MASK = "**/*.md"

const COLLECTION_FOLDERS: CollectionFolderSpec[] = [
  { suffix: "inbox", folder: FOLDERS.inbox },
  { suffix: "notes", folder: FOLDERS.notes },
  { suffix: "journal", folder: FOLDERS.journal },
  { suffix: "templates", folder: FOLDERS.templates },
  { suffix: "attachments", folder: FOLDERS.attachments },
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
  const result = spawnSync("qmd", args, {
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

export function ensureQmdCollections(vaultPath: string): EnsureQmdCollectionsResult {
  const check = runQmdCommand(["--help"], { timeoutMs: 10_000 })
  if (!check.ok && check.errorCode === "ENOENT") {
    return {
      configured: [],
      failed: [],
      skipped: true,
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
