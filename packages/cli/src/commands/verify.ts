import { lstat, readFile, readlink } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { intro, log, text } from "@clack/prompts"

import { DEFAULT_OPENCLAW_WORKSPACE_PATH, DEFAULT_VAULT_PATH, toTildePath, unwrapPrompt } from "../lib/cli"
import {
  FOLDERS_WITH_AGENT,
  FOLDERS_WITHOUT_AGENT,
  JOURNAL_FOLDER_ALIASES,
  NOTES_FOLDER_CANDIDATES,
} from "../lib/folders"
import { readOpenClawConfigFile, readOpenClawExtraPathsByScope } from "../lib/openclaw-config"
import { configureOpenClawEnvForWorkspace } from "../lib/openclaw-workspace"
import { resolveUserPath } from "../lib/paths"
import { detectVaultFromOpenClawConfig, looksLikeZettelclawVault } from "../lib/vault-detect"
import { isDirectory, pathExists } from "../lib/vault-fs"

const JOURNAL_FOLDER_CANDIDATES = [...JOURNAL_FOLDER_ALIASES]
const TEMPLATE_FOLDER_CANDIDATES = [FOLDERS_WITH_AGENT.templates, FOLDERS_WITHOUT_AGENT.templates] as const
const REQUIRED_PLUGIN_IDS = ["templater-obsidian", "obsidian-linter", "dataview"] as const
const AGENT_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "MEMORY.md"] as const

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
    `${templatesFolder}/evergreen.md`,
    `${templatesFolder}/project.md`,
    `${templatesFolder}/research.md`,
    `${templatesFolder}/contact.md`,
    `${templatesFolder}/writing.md`,
    `${templatesFolder}/journal.md`,
    `${templatesFolder}/read-it-later.md`,
    `${templatesFolder}/reading-item.md`,
    `${templatesFolder}/watch-item.md`,
    `${templatesFolder}/clipper-read-it-later.json`,
    `${templatesFolder}/clipper-reading-list.json`,
    `${templatesFolder}/clipper-watch-list.json`,
    `${templatesFolder}/clipper-twitter-bookmark.json`,
    `${templatesFolder}/clipper-youtube-watch.json`,
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

async function buildDataviewCheck(vaultPath: string): Promise<VerifyCheck> {
  const dashboardPath = join(vaultPath, "01 Notes", "Media Queues Dashboard.md")
  const contents = await readFileText(dashboardPath)

  if (!contents) {
    return {
      name: "Dataview dashboard",
      status: "fail",
      detail: "01 Notes/Media Queues Dashboard.md missing",
    }
  }

  if (!contents.includes("```dataview")) {
    return {
      name: "Dataview dashboard",
      status: "warn",
      detail: "dashboard found, but dataview queries were not detected",
    }
  }

  return {
    name: "Dataview dashboard",
    status: "pass",
    detail: "media queue views configured",
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

  const agentFolderPath = join(vaultPath, "02 Agent")
  if (!(await isDirectory(agentFolderPath))) {
    checks.push({
      name: "Agent symlink folder",
      status: "warn",
      detail: "02 Agent not found (likely installed without OpenClaw integration)",
    })

    return checks
  }

  let validCount = 0
  let missingCount = 0
  let mismatchedCount = 0

  for (const file of AGENT_FILES) {
    const linkPath = join(agentFolderPath, file)

    if (!(await pathExists(linkPath))) {
      missingCount += 1
      continue
    }

    try {
      const stats = await lstat(linkPath)
      if (!stats.isSymbolicLink()) {
        mismatchedCount += 1
        continue
      }

      const linkTarget = await readlink(linkPath)
      const resolvedTarget = resolve(dirname(linkPath), linkTarget)
      const expectedTarget = resolve(workspacePath, file)

      if (resolvedTarget === expectedTarget) {
        validCount += 1
      } else {
        mismatchedCount += 1
      }
    } catch {
      mismatchedCount += 1
    }
  }

  if (mismatchedCount === 0 && missingCount === 0 && validCount === AGENT_FILES.length) {
    checks.push({
      name: "Agent symlinks",
      status: "pass",
      detail: `${validCount}/${AGENT_FILES.length} links point at workspace files`,
    })
  } else if (validCount > 0) {
    checks.push({
      name: "Agent symlinks",
      status: "warn",
      detail: `${validCount}/${AGENT_FILES.length} valid, ${missingCount} missing, ${mismatchedCount} mismatched`,
    })
  } else {
    checks.push({
      name: "Agent symlinks",
      status: "fail",
      detail: "No valid symlinks detected in 02 Agent",
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
  checks.push(await buildDataviewCheck(vaultPath))
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
