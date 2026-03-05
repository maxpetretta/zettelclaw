import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { intro, log, text } from "@clack/prompts"

import { DEFAULT_OPENCLAW_WORKSPACE_PATH, DEFAULT_VAULT_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import { JOURNAL_FOLDER_ALIASES, NOTES_FOLDER_CANDIDATES, TEMPLATES_FOLDER_ALIASES } from "../lib/folders"
import { readOpenClawConfigFile, readOpenClawExtraPathsByScope } from "../lib/openclaw-config"
import { configureOpenClawEnvForWorkspace } from "../lib/openclaw-workspace"
import { resolveUserPath } from "../lib/paths"
import { expectedQmdCollections, listQmdCollections } from "../lib/qmd"
import { detectVaultFromOpenClawConfig, looksLikeZettelclawVault } from "../lib/vault-detect"
import { isDirectory, pathExists } from "../lib/vault-fs"

const JOURNAL_FOLDER_CANDIDATES = [...JOURNAL_FOLDER_ALIASES]
const TEMPLATE_FOLDER_CANDIDATES = [...TEMPLATES_FOLDER_ALIASES]
const REQUIRED_PLUGIN_IDS = ["calendar"] as const

export interface VerifyOptions {
  yes: boolean
  vaultPath?: string | undefined
  workspacePath?: string | undefined
}

type CheckStatus = "pass" | "warn" | "fail"

interface VerifyCheck {
  name: string
  status: CheckStatus
  detail: string
}

function hasLegacyTopLevelMemorySearch(config: Record<string, unknown>): boolean {
  return "memorySearch" in config
}

async function promptVaultPath(): Promise<string> {
  const defaultPath = resolveUserPath(DEFAULT_VAULT_PATH)

  return unwrapPrompt(
    await text({
      message: "Where is your Zettelclaw vault?",
      placeholder: toTildePath(defaultPath),
      defaultValue: defaultPath,
    }),
  )
}

async function detectVaultPath(options: VerifyOptions, workspacePath: string): Promise<string | undefined> {
  if (options.vaultPath) {
    return resolveUserPath(options.vaultPath)
  }

  const openclawConfigPath = join(dirname(workspacePath), "openclaw.json")
  const detected = await detectVaultFromOpenClawConfig(
    openclawConfigPath,
    NOTES_FOLDER_CANDIDATES,
    JOURNAL_FOLDER_CANDIDATES,
  )
  if (detected) {
    return detected
  }

  if (options.yes) {
    return undefined
  }

  return resolveUserPath(await promptVaultPath())
}

async function readFileText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return undefined
  }
}

function normalizePath(path: string): string {
  return resolveUserPath(path).replace(/[/\\]+$/u, "")
}

function pathListIncludes(paths: readonly string[], targetPath: string): boolean {
  const target = normalizePath(targetPath)
  return paths.some((value) => normalizePath(value) === target)
}

function formatCheck(check: VerifyCheck): string {
  const icon = check.status === "pass" ? "✅" : check.status === "fail" ? "❌" : "⚠️"
  return `${icon} ${check.name}: ${check.detail}`
}

async function buildTemplateChecks(vaultPath: string): Promise<VerifyCheck[]> {
  let templatesFolder: string | null = null
  for (const candidate of TEMPLATE_FOLDER_CANDIDATES) {
    if (await isDirectory(join(vaultPath, candidate))) {
      templatesFolder = candidate
      break
    }
  }

  if (!templatesFolder) {
    return [{ name: "Templates folder", status: "fail", detail: "Could not find Templates folder" }]
  }

  const requiredTemplateFiles = [
    `${templatesFolder}/note.md`,
    `${templatesFolder}/journal.md`,
    `${templatesFolder}/clipper-capture.json`,
  ] as const

  const checks: VerifyCheck[] = []

  for (const relativeFile of requiredTemplateFiles) {
    const absolutePath = join(vaultPath, relativeFile)
    const exists = await pathExists(absolutePath)
    checks.push({
      name: `Template ${relativeFile}`,
      status: exists ? "pass" : "fail",
      detail: exists ? "present" : "missing",
    })
  }

  return checks
}

async function buildPluginCheck(vaultPath: string): Promise<VerifyCheck> {
  const pluginsPath = join(vaultPath, ".obsidian", "community-plugins.json")
  const raw = await readFileText(pluginsPath)
  if (!raw) {
    return { name: "Community plugins", status: "fail", detail: "community-plugins.json missing" }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { name: "Community plugins", status: "fail", detail: "community-plugins.json is not valid JSON" }
  }

  const ids = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []
  const missing = REQUIRED_PLUGIN_IDS.filter((id) => !ids.includes(id))

  if (missing.length === 0) {
    return { name: "Community plugins", status: "pass", detail: ids.join(", ") }
  }

  return {
    name: "Community plugins",
    status: "fail",
    detail: `missing required plugin ids: ${missing.join(", ")}`,
  }
}

async function buildInboxBaseCheck(vaultPath: string): Promise<VerifyCheck> {
  const inboxBasePath = join(vaultPath, "00 Inbox", "inbox.base")
  const contents = await readFileText(inboxBasePath)

  if (!contents) {
    return {
      name: "Inbox Base view",
      status: "fail",
      detail: "00 Inbox/inbox.base missing",
    }
  }

  const hasInboxFilter = contents.includes('file.inFolder("00 Inbox")')
  const hasMarkdownFilter = contents.includes('file.ext == "md"')

  if (!(hasInboxFilter && hasMarkdownFilter)) {
    return {
      name: "Inbox Base view",
      status: "warn",
      detail: "inbox.base found, but expected inbox markdown filters were not detected",
    }
  }

  return {
    name: "Inbox Base view",
    status: "pass",
    detail: "00 Inbox/inbox.base configured",
  }
}

function buildQmdCheck(vaultPath: string): VerifyCheck {
  const expected = expectedQmdCollections(vaultPath)
  const listed = listQmdCollections()

  if (!listed.ok) {
    return {
      name: "QMD collections",
      status: "warn",
      detail: listed.message ?? "qmd unavailable",
    }
  }

  const names = new Set(listed.names)
  const missing = expected.filter((collection) => !names.has(collection.name))

  if (missing.length === 0) {
    return {
      name: "QMD collections",
      status: "pass",
      detail: `${expected.length} root-folder collections configured`,
    }
  }

  return {
    name: "QMD collections",
    status: "warn",
    detail: `missing ${missing.length}/${expected.length}: ${missing.map((collection) => collection.name).join(", ")}`,
  }
}

async function buildOpenClawChecks(vaultPath: string, workspacePath: string): Promise<VerifyCheck[]> {
  const checks: VerifyCheck[] = []
  const openclawDir = dirname(workspacePath)
  const openclawConfigPath = join(openclawDir, "openclaw.json")

  const configResult = await readOpenClawConfigFile(openclawConfigPath)
  if (!configResult.config) {
    checks.push({
      name: "OpenClaw config",
      status: "warn",
      detail: configResult.error ?? `missing ${toTildePath(openclawConfigPath)}`,
    })
    return checks
  }

  checks.push({ name: "OpenClaw config", status: "pass", detail: toTildePath(openclawConfigPath) })

  if (hasLegacyTopLevelMemorySearch(configResult.config)) {
    checks.push({
      name: "OpenClaw config schema",
      status: "fail",
      detail: "top-level memorySearch is legacy; use agents.defaults.memorySearch",
    })
  }

  const scopedPaths = readOpenClawExtraPathsByScope(configResult.config)
  const allPaths = [...scopedPaths.global, ...scopedPaths.defaults]

  if (pathListIncludes(allPaths, vaultPath)) {
    checks.push({
      name: "OpenClaw memory extraPaths",
      status: "pass",
      detail: "vault path present",
    })
  } else {
    checks.push({
      name: "OpenClaw memory extraPaths",
      status: "fail",
      detail: `vault path missing from extraPaths in ${toTildePath(openclawConfigPath)}`,
    })
  }

  return checks
}

export async function runVerify(options: VerifyOptions): Promise<void> {
  intro("🦞 Zettelclaw - Verify install")

  const checks: VerifyCheck[] = []

  const workspacePath = resolveUserPath(options.workspacePath ?? DEFAULT_OPENCLAW_WORKSPACE_PATH)
  const workspaceDetected = await isDirectory(workspacePath)

  if (workspaceDetected) {
    configureOpenClawEnvForWorkspace(workspacePath)
    checks.push({ name: "OpenClaw workspace", status: "pass", detail: toTildePath(workspacePath) })
  } else {
    checks.push({ name: "OpenClaw workspace", status: "warn", detail: `missing ${toTildePath(workspacePath)}` })
  }

  const vaultPath = await detectVaultPath(options, workspacePath)
  if (!(vaultPath && (await isDirectory(vaultPath)))) {
    throw new Error("Could not find a Zettelclaw vault. Provide --vault or run `zettelclaw init` first.")
  }

  checks.push({ name: "Vault path", status: "pass", detail: toTildePath(vaultPath) })

  if (await looksLikeZettelclawVault(vaultPath, NOTES_FOLDER_CANDIDATES, JOURNAL_FOLDER_CANDIDATES)) {
    checks.push({ name: "Vault structure", status: "pass", detail: "notes + journal folders detected" })
  } else {
    checks.push({ name: "Vault structure", status: "fail", detail: "notes/journal folders not detected" })
  }

  checks.push(await buildPluginCheck(vaultPath))
  checks.push(await buildInboxBaseCheck(vaultPath))
  checks.push(buildQmdCheck(vaultPath))
  checks.push(...(await buildTemplateChecks(vaultPath)))

  if (workspaceDetected) {
    checks.push(...(await buildOpenClawChecks(vaultPath, workspacePath)))
  }

  for (const check of checks) {
    log.message(formatCheck(check))
  }

  const failCount = checks.filter((check) => check.status === "fail").length
  const warnCount = checks.filter((check) => check.status === "warn").length

  if (failCount > 0) {
    throw new Error(`Verification failed with ${failCount} failing checks.`)
  }

  if (warnCount > 0) {
    log.warn(`Verification completed with ${warnCount} warning(s).`)
  }

  log.success("Verification passed.")
}
