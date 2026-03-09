import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  downloadPlugins,
  readEnabledCommunityPlugins,
  readInstalledManagedPlugins,
  readManagedPluginContractState,
} from "../plugins"
import { pathExists } from "../vault-fs"
import { withTempDir, writeJsonFile, writeTextFile } from "./test-helpers"

describe("plugin helpers and managed plugin contract", () => {
  test("reads enabled community plugins and reports config errors", async () => {
    await withTempDir("zettelclaw-plugins-config-", async (dir) => {
      await expect(readEnabledCommunityPlugins(dir)).resolves.toEqual({
        ids: [],
        error: "community-plugins.json missing",
      })

      await writeTextFile(join(dir, ".obsidian", "community-plugins.json"), "{ nope")
      await expect(readEnabledCommunityPlugins(dir)).resolves.toEqual({
        ids: [],
        error: "community-plugins.json is not valid JSON",
      })

      await writeJsonFile(join(dir, ".obsidian", "community-plugins.json"), ["obsidian-git", "calendar"])
      await expect(readEnabledCommunityPlugins(dir)).resolves.toEqual({
        ids: ["calendar", "obsidian-git"],
      })
    })
  })

  test("reads installed managed plugin directories and computes contract drift", async () => {
    await withTempDir("zettelclaw-plugins-contract-", async (dir) => {
      await writeTextFile(join(dir, ".obsidian", "plugins", "calendar", "main.js"), "")
      await writeTextFile(join(dir, ".obsidian", "plugins", "obsidian-git", "main.js"), "")
      await writeTextFile(join(dir, ".obsidian", "plugins", "some-other-plugin", "main.js"), "")

      expect(await readInstalledManagedPlugins(dir)).toEqual(["calendar", "obsidian-git"])
      expect(await readManagedPluginContractState(dir, ["calendar", "obsidian-hider", "some-other-plugin"])).toEqual({
        enabled: ["calendar", "obsidian-hider"],
        installed: ["calendar", "obsidian-git"],
        missingInstalled: ["obsidian-hider"],
        extraInstalled: ["obsidian-git"],
      })
    })
  })

  test("downloadPlugins installs expected managed plugin files with an injected downloader", async () => {
    await withTempDir("zettelclaw-plugins-download-", async (dir) => {
      const result = await downloadPlugins(
        dir,
        { includeGit: true, includeMinimal: true },
        async (_repo, _tag, source) => new TextEncoder().encode(`asset:${source.name}`),
      )

      expect(result.failed).toEqual([])
      expect(result.downloaded).toEqual([
        "calendar",
        "obsidian-git",
        "obsidian-minimal-settings",
        "obsidian-hider",
        "Minimal theme",
      ])

      await expect(pathExists(join(dir, ".obsidian", "plugins", "calendar", "main.js"))).resolves.toBe(true)
      await expect(pathExists(join(dir, ".obsidian", "plugins", "obsidian-git", "manifest.json"))).resolves.toBe(true)
      await expect(pathExists(join(dir, ".obsidian", "themes", "Minimal", "theme.css"))).resolves.toBe(true)
    })
  })

  test("downloadPlugins reports failures when required assets are unavailable", async () => {
    await withTempDir("zettelclaw-plugins-fail-", async (dir) => {
      const result = await downloadPlugins(dir, { includeGit: false, includeMinimal: false }, (_repo, _tag, source) => {
        return Promise.resolve(source.name === "main.js" ? null : new TextEncoder().encode("optional"))
      })

      expect(result.downloaded).toEqual([])
      expect(result.failed).toEqual(["calendar"])
      await expect(pathExists(join(dir, ".obsidian", "plugins", "calendar"))).resolves.toBe(false)
    })
  })
})
