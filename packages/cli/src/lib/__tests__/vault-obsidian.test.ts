import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

import { pathExists } from "../vault-fs"
import { configureApp, configureCommunityPlugins, configureCoreSync, configureMinimalTheme } from "../vault-obsidian"
import { createTempVault as createTempVaultPath, readJsonFile, writeJsonFile } from "./test-helpers"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempVault(): Promise<string> {
  const vaultPath = await createTempVaultPath()
  tempDirs.push(vaultPath)
  return vaultPath
}

describe("configureApp", () => {
  test("defaults to live preview and stacked tabs when settings are missing", async () => {
    const vaultPath = await createTempVault()

    await writeJsonFile(join(vaultPath, ".obsidian", "app.json"), {})
    await writeJsonFile(join(vaultPath, ".obsidian", "workspace.json"), {
      main: {
        type: "split",
        children: [
          {
            type: "tabs",
            children: [],
          },
        ],
      },
    })

    await configureApp(vaultPath)

    const app = await readJsonFile<Record<string, unknown>>(join(vaultPath, ".obsidian", "app.json"))
    const workspace = await readJsonFile<{
      main?: {
        children?: Array<Record<string, unknown>>
      }
    }>(join(vaultPath, ".obsidian", "workspace.json"))

    expect(app.livePreview).toBe(true)
    expect(workspace.main?.children?.[0]?.stacked).toBe(true)
  })

  test("preserves explicit live preview and stacked tab choices", async () => {
    const vaultPath = await createTempVault()

    await writeJsonFile(join(vaultPath, ".obsidian", "app.json"), {
      livePreview: false,
    })
    await writeJsonFile(join(vaultPath, ".obsidian", "workspace.json"), {
      main: {
        type: "split",
        children: [
          {
            type: "tabs",
            stacked: false,
            children: [],
          },
        ],
      },
    })

    await configureApp(vaultPath)

    const app = await readJsonFile<Record<string, unknown>>(join(vaultPath, ".obsidian", "app.json"))
    const workspace = await readJsonFile<{
      main?: {
        children?: Array<Record<string, unknown>>
      }
    }>(join(vaultPath, ".obsidian", "workspace.json"))

    expect(app.livePreview).toBe(false)
    expect(workspace.main?.children?.[0]?.stacked).toBe(false)
  })

  test("rewrites template paths inside workspace state", async () => {
    const vaultPath = await createTempVault()

    await writeJsonFile(join(vaultPath, ".obsidian", "workspace.json"), {
      main: {
        type: "tabs",
        children: [],
      },
      lastOpenFiles: ["04 Templates/journal.md"],
    })

    await configureApp(vaultPath)

    const workspace = await readJsonFile<{ lastOpenFiles?: string[] }>(join(vaultPath, ".obsidian", "workspace.json"))
    expect(workspace.lastOpenFiles).toEqual(["03 Templates/journal.md"])
  })
})

describe("other vault obsidian config helpers", () => {
  test("configureCoreSync toggles the sync core plugin", async () => {
    const vaultPath = await createTempVault()

    await configureCoreSync(vaultPath, "obsidian-sync")
    expect(await readJsonFile<Record<string, boolean>>(join(vaultPath, ".obsidian", "core-plugins.json"))).toEqual({
      sync: true,
    })

    await configureCoreSync(vaultPath, "git")
    expect(await readJsonFile<Record<string, boolean>>(join(vaultPath, ".obsidian", "core-plugins.json"))).toEqual({
      sync: false,
    })
  })

  test("configureCommunityPlugins writes managed plugin config and removes minimal tools when disabled", async () => {
    const vaultPath = await createTempVault()
    await mkdir(join(vaultPath, ".obsidian", "plugins", "obsidian-minimal-settings"), { recursive: true })
    await mkdir(join(vaultPath, ".obsidian", "plugins", "obsidian-hider"), { recursive: true })

    await configureCommunityPlugins(vaultPath, {
      enabled: true,
      includeGit: true,
      includeMinimalThemeTools: true,
    })

    expect(await readJsonFile<string[]>(join(vaultPath, ".obsidian", "community-plugins.json"))).toEqual([
      "calendar",
      "obsidian-git",
      "obsidian-minimal-settings",
      "obsidian-hider",
    ])
    expect(await readJsonFile(join(vaultPath, ".obsidian", "plugins", "calendar", "data.json"))).toMatchObject({
      shouldConfirmBeforeCreate: true,
    })

    await configureCommunityPlugins(vaultPath, {
      enabled: true,
      includeGit: false,
      includeMinimalThemeTools: false,
    })

    expect(await readJsonFile<string[]>(join(vaultPath, ".obsidian", "community-plugins.json"))).toEqual(["calendar"])
    expect(await pathExists(join(vaultPath, ".obsidian", "plugins", "obsidian-minimal-settings"))).toBe(false)
    expect(await pathExists(join(vaultPath, ".obsidian", "plugins", "obsidian-hider"))).toBe(false)
  })

  test("configureCommunityPlugins removes plugin config when disabled", async () => {
    const vaultPath = await createTempVault()
    await configureCommunityPlugins(vaultPath, {
      enabled: true,
      includeGit: false,
      includeMinimalThemeTools: false,
    })

    await configureCommunityPlugins(vaultPath, {
      enabled: false,
      includeGit: false,
      includeMinimalThemeTools: false,
    })

    expect(await readJsonFile(join(vaultPath, ".obsidian", "community-plugins.json")).catch(() => null)).toBeNull()
  })

  test("configureMinimalTheme writes and removes minimal appearance settings", async () => {
    const vaultPath = await createTempVault()

    await configureMinimalTheme(vaultPath, true)
    expect(await readJsonFile<Record<string, unknown>>(join(vaultPath, ".obsidian", "appearance.json"))).toMatchObject({
      cssTheme: "Minimal",
      showRibbon: false,
    })

    await configureMinimalTheme(vaultPath, false)
    expect(await readJsonFile<Record<string, unknown>>(join(vaultPath, ".obsidian", "appearance.json"))).toEqual({
      accentColor: "",
      theme: "system",
      showRibbon: false,
      showViewHeader: true,
      baseFontSize: 14,
    })
    expect(await pathExists(join(vaultPath, ".obsidian", "themes", "Minimal"))).toBe(false)
  })
})
