import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { ensureOpenClawMemoryPath } from "../openclaw"
import {
  parseOpenClawConfig,
  readHookEnabled,
  readOpenClawConfigFile,
  readOpenClawExtraPaths,
  readOpenClawExtraPathsByScope,
} from "../openclaw-config"
import { detectExistingFolder, detectVaultFromOpenClawConfig, looksLikeZettelclawVault } from "../vault-detect"
import { readJsonFile, withTempDir, writeJsonFile, writeTextFile } from "./test-helpers"

describe("openclaw config and vault detection", () => {
  test("parses openclaw config and reads scoped extra paths", () => {
    const config = parseOpenClawConfig(
      JSON.stringify({
        memorySearch: { extraPaths: ["/legacy"] },
        agents: {
          defaults: {
            memorySearch: { extraPaths: ["/vault"] },
          },
        },
      }),
    )

    expect(config).toBeDefined()
    expect(readOpenClawExtraPathsByScope(config ?? {})).toEqual({
      global: ["/legacy"],
      defaults: ["/vault"],
    })
    expect(readOpenClawExtraPaths(config ?? {})).toEqual(["/legacy", "/vault"])
  })

  test("readHookEnabled handles booleans and nested enabled flags", () => {
    expect(readHookEnabled(true)).toBe(true)
    expect(readHookEnabled({ enabled: false })).toBe(false)
    expect(readHookEnabled({ nope: true })).toBeUndefined()
  })

  test("readOpenClawConfigFile reports missing and invalid files", async () => {
    await withTempDir("zettelclaw-openclaw-config-", async (dir) => {
      const missing = await readOpenClawConfigFile(join(dir, "missing.json"))
      expect(missing.error).toContain("OpenClaw config not found")

      const invalidPath = join(dir, "openclaw.json")
      await writeTextFile(invalidPath, "{ not json")
      const invalid = await readOpenClawConfigFile(invalidPath)
      expect(invalid.error).toContain("Could not parse JSON")
    })
  })

  test("ensureOpenClawMemoryPath migrates legacy memorySearch and adds vault path", async () => {
    await withTempDir("zettelclaw-openclaw-patch-", async (dir) => {
      const configPath = join(dir, "openclaw.json")
      await writeJsonFile(configPath, {
        memorySearch: {
          extraPaths: ["/legacy"],
        },
        agents: {},
      })

      await expect(ensureOpenClawMemoryPath("/vault", configPath)).resolves.toEqual({ changed: true })

      const config = await readJsonFile<Record<string, unknown>>(configPath)
      expect(config.memorySearch).toBeUndefined()
      expect(config.agents).toEqual({
        defaults: {
          memorySearch: {
            extraPaths: ["/legacy", "/vault"],
          },
        },
      })
    })
  })

  test("ensureOpenClawMemoryPath reports missing, unreadable, invalid, and unchanged configs", async () => {
    await withTempDir("zettelclaw-openclaw-edge-cases-", async (dir) => {
      const missingPath = join(dir, "missing.json")
      await expect(ensureOpenClawMemoryPath("/vault", missingPath)).resolves.toEqual({
        changed: false,
        message: `OpenClaw config not found at ${missingPath}`,
      })

      const unreadablePath = join(dir, "directory.json")
      await writeTextFile(join(unreadablePath, "marker"), "nope")
      await expect(ensureOpenClawMemoryPath("/vault", unreadablePath)).resolves.toMatchObject({
        changed: false,
        message: expect.stringContaining(`Could not read ${unreadablePath}`),
      })

      const invalidPath = join(dir, "invalid.json")
      await writeTextFile(invalidPath, "{ nope")
      await expect(ensureOpenClawMemoryPath("/vault", invalidPath)).resolves.toMatchObject({
        changed: false,
        message: expect.stringContaining(`Could not patch ${invalidPath}`),
      })

      const unchangedPath = join(dir, "unchanged.json")
      await writeJsonFile(unchangedPath, {
        agents: {
          defaults: {
            memorySearch: {
              extraPaths: ["/vault"],
            },
          },
        },
      })
      await expect(ensureOpenClawMemoryPath("/vault", unchangedPath)).resolves.toEqual({ changed: false })
    })
  })

  test("detects zettelclaw vaults from folder structure and openclaw config", async () => {
    await withTempDir("zettelclaw-vault-detect-", async (dir) => {
      const vaultPath = join(dir, "vault")
      const configPath = join(dir, "openclaw.json")

      await writeTextFile(join(vaultPath, "01 Notes", ".gitkeep"), "")
      await writeTextFile(join(vaultPath, "02 Journal", ".gitkeep"), "")
      await writeJsonFile(configPath, {
        agents: {
          defaults: {
            memorySearch: {
              extraPaths: [vaultPath],
            },
          },
        },
      })

      await expect(detectExistingFolder(vaultPath, ["01 Notes"])).resolves.toBe("01 Notes")
      await expect(looksLikeZettelclawVault(vaultPath, ["01 Notes"], ["02 Journal"])).resolves.toBe(true)
      await expect(detectVaultFromOpenClawConfig(configPath, ["01 Notes"], ["02 Journal"])).resolves.toBe(vaultPath)
    })
  })
})
