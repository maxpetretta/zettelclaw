import {
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import {
  AGENT_FOLDER_ALIASES,
  FOLDERS_WITH_AGENT,
  FOLDERS_WITHOUT_AGENT,
  getVaultFolders,
  JOURNAL_FOLDER_ALIASES,
  LEGACY_FOLDERS,
} from "./folders"

export type SyncMethod = "git" | "obsidian-sync" | "none"

export interface CopyResult {
  added: string[]
  skipped: string[]
  failed: string[]
}

export interface CopyVaultOptions {
  overwrite: boolean
  includeAgent: boolean
}

interface CorePlugins {
  [pluginId: string]: boolean
}

const TEMPLATE_ROOT = resolve(import.meta.dirname, "..", "..", "vault")
const AGENT_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "MEMORY.md"] as const
const TEMPLATE_PATH_PREFIX = /^(?:\d{2} )?Templates\//
const STARTER_NOTE_FILENAME = "Zettelclaw Is Collaborative Memory For Your Agent.md"
const STARTER_RECLAW_FILENAME = "Use Reclaw To Import Old Conversation History.md"

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatLocalTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}

function buildStarterEvergreenNote(dateStamp: string): string {
  return [
    "---",
    "type: evergreen",
    "tags: [agents, systems]",
    'summary: "Zettelclaw is collaborative memory for your agent and human partner."',
    'source: "https://zettelclaw.com"',
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "",
    "Zettelclaw is collaborative memory for your agent.",
    "",
    "It captures session context in journals and keeps durable knowledge in linked typed notes.",
    "",
  ].join("\n")
}

function buildStarterReclawInboxNote(dateStamp: string): string {
  return [
    "---",
    "type: evergreen",
    "tags: [imports, archives]",
    'summary: "Use Reclaw to import old conversation history into your Zettelclaw vault."',
    'source: "https://reclaw.sh"',
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "",
    "[Reclaw](https://reclaw.sh) imports old conversation history so you can bootstrap your vault with prior context.",
    "",
  ].join("\n")
}

function buildStarterJournalEntry(dateStamp: string, timeStamp: string): string {
  return [
    "---",
    "type: journal",
    "tags: [journals]",
    `created: ${dateStamp}`,
    `updated: ${dateStamp}`,
    "---",
    "",
    "## Done",
    "- Zettelclaw setup and installed.",
    "",
    "## Decisions",
    "- Replaced the default OpenClaw memory workflow with Zettelclaw collaborative vault memory.",
    "",
    "## Facts",
    "",
    "## Open",
    "- Use [[Use Reclaw To Import Old Conversation History]] to import old conversation history.",
    "",
    "---",
    "## Sessions",
    `- ZETTELCLAW-SETUP — ${timeStamp}`,
    "",
  ].join("\n")
}

async function writeFileIfMissing(pathToFile: string, content: string): Promise<void> {
  if (await pathExists(pathToFile)) {
    return
  }

  await mkdir(dirname(pathToFile), { recursive: true })
  await writeFile(pathToFile, content, "utf8")
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path)
    return stats.isDirectory()
  } catch {
    return false
  }
}

async function walkFiles(baseDir: string, relativeDir = ""): Promise<string[]> {
  const currentDir = relativeDir ? join(baseDir, ...relativeDir.split("/")) : baseDir
  const entries = await readdir(currentDir, { withFileTypes: true })

  const files: string[] = []

  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(baseDir, relativePath)))
      continue
    }

    files.push(relativePath)
  }

  return files
}

function pathIsInsideFolder(relativePath: string, folder: string): boolean {
  return relativePath === folder || relativePath.startsWith(`${folder}/`)
}

function remapSeedPath(relativePath: string, options: CopyVaultOptions): string | null {
  let mapped = relativePath

  if (mapped === "gitignore") {
    mapped = ".gitignore"
  }

  if (mapped === ".obsidian/workspace.template.json") {
    mapped = ".obsidian/workspace.json"
  }

  if (!options.includeAgent) {
    if (pathIsInsideFolder(mapped, FOLDERS_WITH_AGENT.agent)) {
      return null
    }

    if (mapped.startsWith(`${FOLDERS_WITH_AGENT.journal}/`)) {
      mapped = mapped.replace(`${FOLDERS_WITH_AGENT.journal}/`, `${FOLDERS_WITHOUT_AGENT.journal}/`)
    }

    if (mapped.startsWith(`${FOLDERS_WITH_AGENT.templates}/`)) {
      mapped = mapped.replace(`${FOLDERS_WITH_AGENT.templates}/`, `${FOLDERS_WITHOUT_AGENT.templates}/`)
    }

    if (mapped.startsWith(`${FOLDERS_WITH_AGENT.attachments}/`)) {
      mapped = mapped.replace(`${FOLDERS_WITH_AGENT.attachments}/`, `${FOLDERS_WITHOUT_AGENT.attachments}/`)
    }
  }

  return mapped
}

export async function copyVaultSeed(vaultPath: string, options: CopyVaultOptions): Promise<CopyResult> {
  await mkdir(vaultPath, { recursive: true })

  const files = await walkFiles(TEMPLATE_ROOT)
  const result: CopyResult = {
    added: [],
    skipped: [],
    failed: [],
  }

  for (const relativePath of files) {
    const mappedRelativePath = remapSeedPath(relativePath, options)

    if (!mappedRelativePath) {
      continue
    }

    const source = join(TEMPLATE_ROOT, ...relativePath.split("/"))
    const destination = join(vaultPath, ...mappedRelativePath.split("/"))

    await mkdir(dirname(destination), { recursive: true })

    const exists = await pathExists(destination)

    if (exists && !options.overwrite) {
      result.skipped.push(mappedRelativePath)
      continue
    }

    await copyFile(source, destination)
    result.added.push(mappedRelativePath)
  }

  return result
}

export async function seedVaultStarterContent(vaultPath: string, includeAgent: boolean): Promise<void> {
  const folders = getVaultFolders(includeAgent)
  const now = new Date()
  const dateStamp = formatLocalDate(now)
  const timeStamp = formatLocalTime(now)

  const starterNotePath = join(vaultPath, folders.notes, STARTER_NOTE_FILENAME)
  const starterReclawPath = join(vaultPath, folders.inbox, STARTER_RECLAW_FILENAME)
  const starterJournalPath = join(vaultPath, folders.journal, `${dateStamp}.md`)

  await writeFileIfMissing(starterNotePath, buildStarterEvergreenNote(dateStamp))
  await writeFileIfMissing(starterReclawPath, buildStarterReclawInboxNote(dateStamp))
  await writeFileIfMissing(starterJournalPath, buildStarterJournalEntry(dateStamp, timeStamp))
}

export async function removePathIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

function isSymlinkPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === "EPERM" || code === "EACCES" || code === "ENOTSUP"
}

export async function createAgentSymlinks(vaultPath: string, workspacePath: string): Promise<CopyResult> {
  const agentFolder = FOLDERS_WITH_AGENT.agent
  const agentDir = join(vaultPath, agentFolder)
  await mkdir(agentDir, { recursive: true })

  const result: CopyResult = {
    added: [],
    skipped: [],
    failed: [],
  }

  for (const file of AGENT_FILES) {
    const linkPath = join(agentDir, file)
    const targetPath = join(workspacePath, file)
    const relativePath = `${agentFolder}/${file}`

    let existingStats: Awaited<ReturnType<typeof lstat>> | null = null
    try {
      existingStats = await lstat(linkPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        throw new Error(
          `Could not inspect existing link ${linkPath}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    if (existingStats) {
      if (existingStats.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath)
        if (existingTarget === targetPath) {
          result.skipped.push(relativePath)
          continue
        }
      }

      result.skipped.push(relativePath)
      continue
    }

    try {
      await symlink(targetPath, linkPath)
      result.added.push(relativePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "EEXIST") {
        result.skipped.push(relativePath)
        continue
      }

      if (isSymlinkPermissionError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        result.failed.push(`${relativePath}: ${message}`)
        continue
      }

      throw new Error(
        `Could not create symlink ${linkPath} -> ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  await removePathIfExists(join(agentDir, ".gitkeep"))

  return result
}

async function moveFolderIfPossible(vaultPath: string, sourceFolder: string, destinationFolder: string): Promise<void> {
  const sourcePath = join(vaultPath, sourceFolder)
  const destinationPath = join(vaultPath, destinationFolder)

  if (!(await pathExists(sourcePath))) {
    return
  }

  if (await pathExists(destinationPath)) {
    return
  }

  await rename(sourcePath, destinationPath)
}

async function moveFirstAliasToCanonical(
  vaultPath: string,
  canonicalFolder: string,
  aliasFolders: readonly string[],
): Promise<void> {
  const canonicalPath = join(vaultPath, canonicalFolder)

  if (await pathExists(canonicalPath)) {
    return
  }

  for (const alias of aliasFolders) {
    if (alias === canonicalFolder) {
      continue
    }

    const aliasPath = join(vaultPath, alias)
    if (await pathExists(aliasPath)) {
      await rename(aliasPath, canonicalPath)
      return
    }
  }
}

async function folderContainsOnlyManagedAgentEntries(pathToFolder: string): Promise<boolean> {
  if (!(await pathExists(pathToFolder))) {
    return false
  }

  const entries = await readdir(pathToFolder, { withFileTypes: true })

  if (entries.length === 0) {
    return true
  }

  for (const entry of entries) {
    if (entry.name === ".gitkeep") {
      continue
    }

    const entryPath = join(pathToFolder, entry.name)
    const stats = await lstat(entryPath)

    if (!stats.isSymbolicLink()) {
      return false
    }
  }

  return true
}

async function removeManagedAgentFolderIfSafe(vaultPath: string, folderName: string): Promise<void> {
  const folderPath = join(vaultPath, folderName)

  if (!(await pathExists(folderPath))) {
    return
  }

  if (await folderContainsOnlyManagedAgentEntries(folderPath)) {
    await removePathIfExists(folderPath)
  }
}

export async function configureAgentFolder(vaultPath: string, enabled: boolean): Promise<void> {
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.inbox, FOLDERS_WITH_AGENT.inbox)
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.notes, FOLDERS_WITH_AGENT.notes)

  if (enabled) {
    await moveFirstAliasToCanonical(vaultPath, FOLDERS_WITH_AGENT.journal, JOURNAL_FOLDER_ALIASES)
    await moveFirstAliasToCanonical(vaultPath, FOLDERS_WITH_AGENT.agent, AGENT_FOLDER_ALIASES)
    await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.templates, FOLDERS_WITH_AGENT.templates)
    await moveFolderIfPossible(vaultPath, FOLDERS_WITHOUT_AGENT.templates, FOLDERS_WITH_AGENT.templates)
    await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.attachments, FOLDERS_WITH_AGENT.attachments)
    await moveFolderIfPossible(vaultPath, FOLDERS_WITHOUT_AGENT.attachments, FOLDERS_WITH_AGENT.attachments)
    await mkdir(join(vaultPath, FOLDERS_WITH_AGENT.agent), { recursive: true })
    return
  }

  for (const agentFolder of AGENT_FOLDER_ALIASES) {
    await removeManagedAgentFolderIfSafe(vaultPath, agentFolder)
  }

  await moveFirstAliasToCanonical(vaultPath, FOLDERS_WITHOUT_AGENT.journal, JOURNAL_FOLDER_ALIASES)
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.templates, FOLDERS_WITHOUT_AGENT.templates)
  await moveFolderIfPossible(vaultPath, FOLDERS_WITH_AGENT.templates, FOLDERS_WITHOUT_AGENT.templates)
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.attachments, FOLDERS_WITHOUT_AGENT.attachments)
  await moveFolderIfPossible(vaultPath, FOLDERS_WITH_AGENT.attachments, FOLDERS_WITHOUT_AGENT.attachments)
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8")
  return JSON.parse(raw) as T
}

async function readJsonFileOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    return await readJsonFile<T>(path)
  } catch {
    return fallback
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function rewriteTemplatePaths(value: unknown, templatesFolder: string): unknown {
  if (typeof value === "string") {
    return value.replace(TEMPLATE_PATH_PREFIX, `${templatesFolder}/`)
  }

  if (Array.isArray(value)) {
    return value.map((entry) => rewriteTemplatePaths(entry, templatesFolder))
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      next[key] = rewriteTemplatePaths(nested, templatesFolder)
    }

    return next
  }

  return value
}

export async function configureApp(pathToVault: string, includeAgent: boolean): Promise<void> {
  const folders = getVaultFolders(includeAgent)
  const journalTemplatePath = `${folders.templates}/journal.md`

  const appPath = join(pathToVault, ".obsidian", "app.json")
  const existingAppConfig = await readJsonFileOrDefault<Record<string, unknown>>(appPath, {})
  const appConfig = {
    ...existingAppConfig,
    attachmentFolderPath: folders.attachments,
    newFileLocation: "folder",
    newFileFolderPath: folders.notes,
  }

  await writeJsonFile(appPath, appConfig)

  const dailyNotesPath = join(pathToVault, ".obsidian", "daily-notes.json")
  const dailyNotesConfig = await readJsonFileOrDefault<Record<string, unknown>>(dailyNotesPath, {})
  dailyNotesConfig.folder = folders.journal
  dailyNotesConfig.template = journalTemplatePath

  if (typeof dailyNotesConfig.format !== "string") {
    dailyNotesConfig.format = "YYYY-MM-DD"
  }

  await writeJsonFile(dailyNotesPath, dailyNotesConfig)

  const templatesPath = join(pathToVault, ".obsidian", "templates.json")
  const templatesConfig = await readJsonFileOrDefault<Record<string, unknown>>(templatesPath, {})
  templatesConfig.folder = folders.templates
  await writeJsonFile(templatesPath, templatesConfig)

  const templaterPath = join(pathToVault, ".obsidian", "plugins", "templater-obsidian", "data.json")

  if (await pathExists(templaterPath)) {
    const templaterConfig = await readJsonFileOrDefault<Record<string, unknown>>(templaterPath, {})
    templaterConfig.templates_folder = folders.templates
    templaterConfig.trigger_on_file_creation = true
    templaterConfig.enable_folder_templates = true

    const rawRules = Array.isArray(templaterConfig.folder_templates) ? templaterConfig.folder_templates : []
    const normalizedRules: unknown[] = []
    let journalRuleSet = false

    for (const rule of rawRules) {
      if (!rule || typeof rule !== "object") {
        normalizedRules.push(rule)
        continue
      }

      const nextRule = { ...(rule as Record<string, unknown>) }
      const ruleFolder = typeof nextRule.folder === "string" ? nextRule.folder : ""
      const isJournalRule =
        JOURNAL_FOLDER_ALIASES.includes(ruleFolder) ||
        (typeof nextRule.template === "string" && nextRule.template.endsWith("/journal.md"))

      if (isJournalRule) {
        nextRule.folder = folders.journal
        nextRule.template = journalTemplatePath
        journalRuleSet = true
      }

      normalizedRules.push(nextRule)
    }

    if (!journalRuleSet) {
      normalizedRules.push({
        folder: folders.journal,
        template: journalTemplatePath,
      })
    }

    templaterConfig.folder_templates = normalizedRules
    await writeJsonFile(templaterPath, templaterConfig)
  }

  const workspacePath = join(pathToVault, ".obsidian", "workspace.json")

  if (await pathExists(workspacePath)) {
    const workspace = await readJsonFileOrDefault<unknown>(workspacePath, {})
    const nextWorkspace = rewriteTemplatePaths(workspace, folders.templates)
    await writeJsonFile(workspacePath, nextWorkspace)
  }
}

export async function configureCoreSync(pathToVault: string, method: SyncMethod): Promise<void> {
  const corePluginsPath = join(pathToVault, ".obsidian", "core-plugins.json")
  const plugins = await readJsonFileOrDefault<CorePlugins>(corePluginsPath, {})
  plugins.sync = method === "obsidian-sync"
  await writeJsonFile(corePluginsPath, plugins)
}

interface CommunityPluginOptions {
  enabled: boolean
  includeGit: boolean
  includeMinimalThemeTools: boolean
}

function buildCommunityPlugins(options: CommunityPluginOptions): string[] {
  const plugins: string[] = ["templater-obsidian", "obsidian-linter"]

  if (options.includeGit) {
    plugins.push("obsidian-git")
  }

  if (options.includeMinimalThemeTools) {
    plugins.push("obsidian-minimal-settings", "obsidian-hider")
  }

  return plugins
}

async function writeMinimalPluginConfigs(pathToVault: string): Promise<void> {
  const minimalSettingsPath = join(pathToVault, ".obsidian", "plugins", "obsidian-minimal-settings", "data.json")

  const hiderPath = join(pathToVault, ".obsidian", "plugins", "obsidian-hider", "data.json")

  await writeJsonFile(minimalSettingsPath, {
    lightStyle: "minimal-light",
    darkStyle: "minimal-dark",
    colorfulHeadings: true,
    colorfulFrame: false,
    trimFileName: true,
    focusMode: false,
    underlineInternal: true,
    underlineExternal: true,
    fullWidthMedia: true,
  })

  await writeJsonFile(hiderPath, {
    hideVaultName: false,
    hideScrollbar: false,
    hideTitleBar: false,
    hideStatusBar: false,
    hideTabHeader: false,
    hideSearchSuggestions: false,
    hidePropertiesReading: true,
  })
}

export async function configureCommunityPlugins(pathToVault: string, options: CommunityPluginOptions): Promise<void> {
  const communityPath = join(pathToVault, ".obsidian", "community-plugins.json")
  const pluginFolderPath = join(pathToVault, ".obsidian", "plugins")

  if (!options.enabled) {
    await removePathIfExists(communityPath)
    await removePathIfExists(pluginFolderPath)
    return
  }

  const plugins = buildCommunityPlugins(options)
  await writeJsonFile(communityPath, plugins)

  if (options.includeMinimalThemeTools) {
    await writeMinimalPluginConfigs(pathToVault)
  } else {
    await removePathIfExists(join(pluginFolderPath, "obsidian-minimal-settings"))
    await removePathIfExists(join(pluginFolderPath, "obsidian-hider"))
  }
}

export async function configureMinimalTheme(pathToVault: string, enabled: boolean): Promise<void> {
  const appearancePath = join(pathToVault, ".obsidian", "appearance.json")
  const themePath = join(pathToVault, ".obsidian", "themes", "Minimal")

  if (!enabled) {
    const appearance = await readJsonFileOrDefault<Record<string, unknown>>(appearancePath, {})

    if (appearance.cssTheme === "Minimal") {
      const { cssTheme: _cssTheme, ...rest } = appearance
      if (Object.keys(rest).length === 0) {
        await removePathIfExists(appearancePath)
      } else {
        await writeJsonFile(appearancePath, rest)
      }
    }

    await removePathIfExists(themePath)
    return
  }

  const appearance = await readJsonFileOrDefault<Record<string, unknown>>(appearancePath, {})
  const nextAppearance = {
    ...appearance,
    cssTheme: "Minimal",
  }
  await writeJsonFile(appearancePath, nextAppearance)

  await mkdir(themePath, { recursive: true })
}
