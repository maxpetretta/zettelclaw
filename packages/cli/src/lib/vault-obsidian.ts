import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import { getVaultFolders } from "./folders"
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

const MINIMAL_APPEARANCE_DEFAULTS: Record<string, unknown> = {
  accentColor: "",
  theme: "system",
  cssTheme: "Minimal",
  showRibbon: false,
  showViewHeader: true,
  baseFontSize: 14,
}

function enableMainTabsStackedByDefault(workspace: unknown): unknown {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    return workspace
  }

  const workspaceState = workspace as Record<string, unknown>
  return {
    ...workspaceState,
    main: enableTabsStackedByDefault(workspaceState.main),
  }
}

function enableTabsStackedByDefault(node: unknown): unknown {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return node
  }

  const workspaceNode = node as Record<string, unknown>

  if (workspaceNode.type === "tabs") {
    return {
      ...workspaceNode,
      stacked: typeof workspaceNode.stacked === "boolean" ? workspaceNode.stacked : true,
    }
  }

  if (!Array.isArray(workspaceNode.children)) {
    return workspaceNode
  }

  let stackedApplied = false
  const children = workspaceNode.children.map((child) => {
    if (stackedApplied) {
      return child
    }

    const nextChild = enableTabsStackedByDefault(child)
    if (nextChild !== child) {
      stackedApplied = true
    }
    return nextChild
  })

  return {
    ...workspaceNode,
    children,
  }
}

export async function configureApp(pathToVault: string): Promise<void> {
  const folders = getVaultFolders()
  const journalTemplatePath = `${folders.templates}/journal.md`

  const appPath = join(pathToVault, ".obsidian", "app.json")
  const existingAppConfig = await readJsonFileOrDefault<Record<string, unknown>>(appPath, {})
  const appConfig = {
    ...existingAppConfig,
    livePreview: typeof existingAppConfig.livePreview === "boolean" ? existingAppConfig.livePreview : true,
    openBehavior: typeof existingAppConfig.openBehavior === "string" ? existingAppConfig.openBehavior : "daily",
    attachmentFolderPath: folders.attachments,
    newFileLocation: "folder",
    newFileFolderPath: folders.notes,
    propertiesInDocument:
      typeof existingAppConfig.propertiesInDocument === "string" ? existingAppConfig.propertiesInDocument : "source",
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

  const backlinkPath = join(pathToVault, ".obsidian", "backlink.json")
  const backlinkConfig = await readJsonFileOrDefault<Record<string, unknown>>(backlinkPath, {})
  backlinkConfig.backlinkInDocument =
    typeof backlinkConfig.backlinkInDocument === "boolean" ? backlinkConfig.backlinkInDocument : false
  await writeJsonFile(backlinkPath, backlinkConfig)

  const workspacePath = join(pathToVault, ".obsidian", "workspace.json")

  if (await pathExists(workspacePath)) {
    const workspace = await readJsonFileOrDefault<unknown>(workspacePath, {})
    const nextWorkspace = enableMainTabsStackedByDefault(workspace)
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
  const plugins: string[] = ["calendar"]

  if (options.includeGit) {
    plugins.push("obsidian-git")
  }

  if (options.includeMinimalThemeTools) {
    plugins.push("obsidian-minimal-settings", "obsidian-hider")
  }

  return plugins
}

async function writeCalendarPluginConfig(pathToVault: string): Promise<void> {
  const calendarSettingsPath = join(pathToVault, ".obsidian", "plugins", "calendar", "data.json")

  await writeJsonFile(calendarSettingsPath, {
    shouldConfirmBeforeCreate: true,
    weekStart: "locale",
    wordsPerDot: 250,
    showWeeklyNote: false,
    weeklyNoteFormat: "",
    weeklyNoteTemplate: "",
    weeklyNoteFolder: "",
    localeOverride: "system-default",
  })
}

async function writeMinimalPluginConfigs(pathToVault: string): Promise<void> {
  const minimalSettingsPath = join(pathToVault, ".obsidian", "plugins", "obsidian-minimal-settings", "data.json")

  const hiderPath = join(pathToVault, ".obsidian", "plugins", "obsidian-hider", "data.json")

  await writeJsonFile(minimalSettingsPath, {
    lightStyle: "minimal-light",
    darkStyle: "minimal-dark",
    lightScheme: "minimal-default-light",
    darkScheme: "minimal-default-dark",
    editorFont: "",
    lineHeight: 1.5,
    lineWidth: 50,
    lineWidthWide: 50,
    maxWidth: 88,
    textNormal: 14,
    textSmall: 13,
    imgGrid: false,
    imgWidth: "img-default-width",
    tableWidth: "table-default-width",
    iframeWidth: "iframe-default-width",
    mapWidth: "map-default-width",
    chartWidth: "chart-default-width",
    colorfulHeadings: false,
    colorfulFrame: false,
    colorfulActiveStates: false,
    trimNames: true,
    labeledNav: true,
    fullWidthMedia: true,
    bordersToggle: true,
    minimalStatus: true,
    focusMode: false,
    underlineInternal: true,
    underlineExternal: true,
    folding: true,
    lineNumbers: false,
    readableLineLength: true,
    devBlockWidth: false,
  })

  await writeJsonFile(hiderPath, {
    hideStatus: false,
    hideTabs: false,
    hideScroll: false,
    hideSidebarButtons: false,
    hideTooltips: false,
    hideFileNavButtons: true,
    hideSearchSuggestions: false,
    hideSearchCounts: false,
    hideInstructions: false,
    hidePropertiesReading: false,
    hideVault: false,
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
  await writeCalendarPluginConfig(pathToVault)

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
    ...MINIMAL_APPEARANCE_DEFAULTS,
    ...appearance,
    cssTheme: "Minimal",
  }
  await writeJsonFile(appearancePath, nextAppearance)

  await mkdir(themePath, { recursive: true })
}
