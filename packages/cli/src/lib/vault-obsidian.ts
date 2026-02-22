import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import { getVaultFolders, JOURNAL_FOLDER_ALIASES } from "./folders"
import { pathExists, readJsonFileOrDefault, removePathIfExists, writeJsonFile } from "./vault-fs"

export type SyncMethod = "git" | "obsidian-sync" | "none"

interface CorePlugins {
  [pluginId: string]: boolean
}

export interface CommunityPluginOptions {
  enabled: boolean
  includeGit: boolean
  includeMinimalThemeTools: boolean
}

const TEMPLATE_PATH_PREFIX = /^(?:\d{2} )?Templates\//

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
