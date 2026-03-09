import { readFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { intro, log, text } from "@clack/prompts"

import {
  DEFAULT_OPENCLAW_WORKSPACE_PATH,
  DEFAULT_VAULT_PATH,
  formatCommandIntro,
  toTildePath,
  unwrapPrompt,
} from "../lib/cli"
import { FOLDERS } from "../lib/folders"
import { readOpenClawConfigFile, readOpenClawExtraPathsByScope } from "../lib/openclaw-config"
import { configureOpenClawEnvForWorkspace } from "../lib/openclaw-workspace"
import { resolveUserPath } from "../lib/paths"
import { readEnabledCommunityPlugins, readManagedPluginContractState } from "../lib/plugins"
import { expectedQmdCollections, listQmdCollections } from "../lib/qmd"
import { detectVaultFromOpenClawConfig, looksLikeZettelclawVault } from "../lib/vault-detect"
import { isDirectory, pathExists } from "../lib/vault-fs"

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

interface VerifySection {
  title: string
  checks: VerifyCheck[]
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
  const detected = await detectVaultFromOpenClawConfig(openclawConfigPath, [FOLDERS.notes], [FOLDERS.journal])
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

function parseJsonRecord(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined
    }
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

function formatCheck(check: VerifyCheck): string {
  const icon = check.status === "pass" ? "✅" : check.status === "fail" ? "❌" : "⚠️"
  return `${icon} ${check.name}: ${check.detail}`
}

function formatSection(section: VerifySection): string {
  return [section.title, ...section.checks.map((check) => formatCheck(check))].join("\n")
}

function combineStatuses(left: CheckStatus, right: CheckStatus): CheckStatus {
  if (left === "fail" || right === "fail") {
    return "fail"
  }

  if (left === "warn" || right === "warn") {
    return "warn"
  }

  return "pass"
}

function formatVaultFolderLabel(path: string): string {
  return basename(path).replace(/^\d{2}\s+/u, "")
}

function summarizeQmdIssue(message: string | undefined, missingBinary: boolean | undefined): string {
  if (missingBinary) {
    return "qmd not installed"
  }

  if (!message) {
    return "qmd unavailable"
  }

  if (message.includes("ERR_DLOPEN_FAILED") || message.includes("better_sqlite3.node")) {
    return "QMD native module failed to load; reinstall QMD for the current Node version"
  }

  const firstLine = message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return firstLine ?? "qmd unavailable"
}

function findTabsNode(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return undefined
  }

  const record = node as Record<string, unknown>
  if (record.type === "tabs") {
    return record
  }

  if (!Array.isArray(record.children)) {
    return undefined
  }

  for (const child of record.children) {
    const found = findTabsNode(child)
    if (found) {
      return found
    }
  }

  return undefined
}

async function findTemplatesFolder(vaultPath: string): Promise<string | null> {
  return (await isDirectory(join(vaultPath, FOLDERS.templates))) ? FOLDERS.templates : null
}

async function buildPluginCheck(vaultPath: string): Promise<VerifyCheck> {
  const enabledResult = await readEnabledCommunityPlugins(vaultPath)
  if (enabledResult.error) {
    return { name: "Plugins", status: "fail", detail: enabledResult.error }
  }

  const missingRequired = REQUIRED_PLUGIN_IDS.filter((id) => !enabledResult.ids.includes(id))
  if (missingRequired.length > 0) {
    return {
      name: "Plugins",
      status: "fail",
      detail: `missing required plugin ids: ${missingRequired.join(", ")}`,
    }
  }

  const contract = await readManagedPluginContractState(vaultPath, enabledResult.ids)
  const detailParts = [`enabled: ${contract.enabled.join(", ") || "none"}`]

  if (contract.missingInstalled.length > 0) {
    detailParts.push(`missing installed assets: ${contract.missingInstalled.join(", ")}`)
  }

  if (contract.extraInstalled.length > 0) {
    detailParts.push(`extra installed: ${contract.extraInstalled.join(", ")}`)
  }

  if (contract.missingInstalled.length > 0) {
    return {
      name: "Plugins",
      status: "fail",
      detail: detailParts.join("; "),
    }
  }

  if (contract.extraInstalled.length > 0) {
    return {
      name: "Plugins",
      status: "warn",
      detail: detailParts.join("; "),
    }
  }

  return {
    name: "Plugins",
    status: "pass",
    detail: detailParts.join("; "),
  }
}

async function buildVaultSettingsCheck(vaultPath: string): Promise<VerifyCheck> {
  let status: CheckStatus = "pass"
  const issues: string[] = []

  const appConfig = parseJsonRecord(await readFileText(join(vaultPath, ".obsidian", "app.json")))
  if (!appConfig) {
    status = combineStatuses(status, "warn")
    issues.push("app.json missing or invalid")
  } else if (appConfig.livePreview !== true) {
    status = combineStatuses(status, "warn")
    issues.push("Live Preview off")
  }

  const workspace = parseJsonRecord(await readFileText(join(vaultPath, ".obsidian", "workspace.json")))
  if (!workspace) {
    status = combineStatuses(status, "warn")
    issues.push("workspace.json missing or invalid")
  } else {
    const mainTabs = findTabsNode(workspace.main)
    if (!mainTabs || mainTabs.stacked !== true) {
      status = combineStatuses(status, "warn")
      issues.push("stacked tabs off")
    }
  }

  const appearance = parseJsonRecord(await readFileText(join(vaultPath, ".obsidian", "appearance.json")))
  const minimalThemeEnabled = appearance?.cssTheme === "Minimal"
  if (minimalThemeEnabled && !(await pathExists(join(vaultPath, ".obsidian", "themes", "Minimal")))) {
    status = combineStatuses(status, "fail")
    issues.push("Minimal theme assets missing")
  }

  const inboxBasePath = join(vaultPath, "00 Inbox", "inbox.base")
  const inboxBaseContents = await readFileText(inboxBasePath)
  if (!inboxBaseContents) {
    status = combineStatuses(status, "fail")
    issues.push("Inbox Base missing")
  } else {
    const hasInboxFilter = inboxBaseContents.includes('file.inFolder("00 Inbox")')
    const hasMarkdownFilter = inboxBaseContents.includes('file.ext == "md"')

    if (!(hasInboxFilter && hasMarkdownFilter)) {
      status = combineStatuses(status, "warn")
      issues.push("Inbox Base filters not detected")
    }
  }

  const templatesFolder = await findTemplatesFolder(vaultPath)
  if (!templatesFolder) {
    status = combineStatuses(status, "fail")
    issues.push("Templates folder missing")
  } else {
    const requiredTemplateFiles = [
      `${templatesFolder}/note.md`,
      `${templatesFolder}/journal.md`,
      `${templatesFolder}/clipper-capture.json`,
    ] as const

    const missingTemplates: string[] = []
    for (const relativeFile of requiredTemplateFiles) {
      if (!(await pathExists(join(vaultPath, relativeFile)))) {
        missingTemplates.push(basename(relativeFile))
      }
    }

    if (missingTemplates.length > 0) {
      status = combineStatuses(status, "fail")
      issues.push(`missing templates: ${missingTemplates.join(", ")}`)
    }
  }

  if (status === "pass") {
    return {
      name: "Settings",
      status,
      detail: minimalThemeEnabled
        ? "Live Preview on, stacked tabs enabled, Inbox Base configured, templates present, Minimal theme installed"
        : "Live Preview on, stacked tabs enabled, Inbox Base configured, templates present",
    }
  }

  return {
    name: "Settings",
    status,
    detail: issues.join("; "),
  }
}

function buildQmdChecks(vaultPath: string): VerifyCheck[] {
  const expected = expectedQmdCollections(vaultPath)
  const listed = listQmdCollections()

  if (!listed.ok) {
    return [
      {
        name: "Installed",
        status: "warn",
        detail: summarizeQmdIssue(listed.message, listed.missingBinary),
      },
      {
        name: "Collections",
        status: "warn",
        detail: listed.missingBinary ? "skipped until QMD is installed" : "skipped until QMD is healthy",
      },
    ]
  }

  const names = new Set(listed.names)
  const missing = expected.filter((collection) => !names.has(collection.name))
  const configured = expected
    .filter((collection) => names.has(collection.name))
    .map((collection) => formatVaultFolderLabel(collection.path))

  if (missing.length === 0) {
    return [
      {
        name: "Installed",
        status: "pass",
        detail: "qmd available",
      },
      {
        name: "Collections",
        status: "pass",
        detail: configured.join(", "),
      },
    ]
  }

  const missingLabels = missing.map((collection) => formatVaultFolderLabel(collection.path))
  const detailParts: string[] = []

  if (configured.length > 0) {
    detailParts.push(`configured: ${configured.join(", ")}`)
  }
  detailParts.push(`missing: ${missingLabels.join(", ")}`)

  return [
    {
      name: "Installed",
      status: "pass",
      detail: "qmd available",
    },
    {
      name: "Collections",
      status: "warn",
      detail: detailParts.join("; "),
    },
  ]
}

async function buildOpenClawChecks(vaultPath: string, workspacePath: string): Promise<VerifyCheck[]> {
  const openclawDir = dirname(workspacePath)
  const openclawConfigPath = join(openclawDir, "openclaw.json")

  const configResult = await readOpenClawConfigFile(openclawConfigPath)
  if (!configResult.config) {
    return [
      {
        name: "Settings",
        status: "warn",
        detail: configResult.error ?? `missing ${toTildePath(openclawConfigPath)}`,
      },
      {
        name: "Memory paths",
        status: "warn",
        detail: "skipped until OpenClaw settings are available",
      },
    ]
  }

  const settingsCheck: VerifyCheck = hasLegacyTopLevelMemorySearch(configResult.config)
    ? {
        name: "Settings",
        status: "fail",
        detail: `legacy top-level memorySearch in ${toTildePath(openclawConfigPath)}; use agents.defaults.memorySearch`,
      }
    : {
        name: "Settings",
        status: "pass",
        detail: toTildePath(openclawConfigPath),
      }

  const scopedPaths = readOpenClawExtraPathsByScope(configResult.config)
  const allPaths = [...scopedPaths.global, ...scopedPaths.defaults]

  if (pathListIncludes(allPaths, vaultPath)) {
    return [
      settingsCheck,
      {
        name: "Memory paths",
        status: "pass",
        detail: "vault path present",
      },
    ]
  }

  return [
    settingsCheck,
    {
      name: "Memory paths",
      status: "fail",
      detail: `vault path missing from extraPaths in ${toTildePath(openclawConfigPath)}`,
    },
  ]
}

export const __testing = {
  buildOpenClawChecks,
  buildPluginCheck,
  buildQmdChecks,
  buildVaultSettingsCheck,
  combineStatuses,
  findTabsNode,
  formatCheck,
  formatSection,
  formatVaultFolderLabel,
  hasLegacyTopLevelMemorySearch,
  normalizePath,
  parseJsonRecord,
  pathListIncludes,
  summarizeQmdIssue,
}

export async function runVerify(options: VerifyOptions): Promise<void> {
  intro(formatCommandIntro())

  const vaultChecks: VerifyCheck[] = []
  const openClawChecks: VerifyCheck[] = []

  const workspacePath = resolveUserPath(options.workspacePath ?? DEFAULT_OPENCLAW_WORKSPACE_PATH)
  const workspaceDetected = await isDirectory(workspacePath)

  if (workspaceDetected) {
    configureOpenClawEnvForWorkspace(workspacePath)
    openClawChecks.push({ name: "Workspace", status: "pass", detail: toTildePath(workspacePath) })
  } else {
    openClawChecks.push({ name: "Workspace", status: "warn", detail: `missing ${toTildePath(workspacePath)}` })
  }

  const vaultPath = await detectVaultPath(options, workspacePath)
  if (!(vaultPath && (await isDirectory(vaultPath)))) {
    throw new Error("Could not find a Zettelclaw vault. Provide --vault or run `zettelclaw init` first.")
  }

  vaultChecks.push({ name: "Path", status: "pass", detail: toTildePath(vaultPath) })

  if (await looksLikeZettelclawVault(vaultPath, [FOLDERS.notes], [FOLDERS.journal])) {
    vaultChecks.push({ name: "Structure", status: "pass", detail: "notes + journal folders detected" })
  } else {
    vaultChecks.push({ name: "Structure", status: "fail", detail: "notes/journal folders not detected" })
  }

  vaultChecks.push(await buildPluginCheck(vaultPath))
  vaultChecks.push(await buildVaultSettingsCheck(vaultPath))

  if (workspaceDetected) {
    openClawChecks.push(...(await buildOpenClawChecks(vaultPath, workspacePath)))
  } else {
    openClawChecks.push(
      { name: "Settings", status: "warn", detail: "skipped until workspace is available" },
      { name: "Memory paths", status: "warn", detail: "skipped until workspace is available" },
    )
  }

  const qmdChecks = buildQmdChecks(vaultPath)
  const sections: VerifySection[] = [
    { title: "Vault", checks: vaultChecks },
    { title: "OpenClaw", checks: openClawChecks },
    { title: "QMD", checks: qmdChecks },
  ]

  log.message(sections.map((section) => formatSection(section)).join("\n\n"))

  const checks = sections.flatMap((section) => section.checks)
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
