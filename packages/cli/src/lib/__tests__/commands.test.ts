import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

import { runInit } from "../../commands/init"
import { runVerify } from "../../commands/verify"
import { downloadPlugins } from "../plugins"
import { expectedQmdCollections } from "../qmd"
import { configureVaultFolders } from "../vault-folders"
import { configureApp, configureCommunityPlugins, configureCoreSync, configureMinimalTheme } from "../vault-obsidian"
import { copyVaultSeed, seedVaultStarterContent } from "../vault-seed"
import {
  readJsonFile,
  readTextFile,
  withEnv,
  withTempDir,
  writeExecutable,
  writeJsonFile,
  writeTextFile,
} from "./test-helpers"

function qmdListScript(vaultPath: string): string {
  const lines = expectedQmdCollections(vaultPath).map(
    (collection) => `  printf '%s\\n' '${collection.name} (qmd://zettelclaw/${collection.name})'`,
  )

  return `#!/bin/sh
if [ "$1" = "collection" ] && [ "$2" = "list" ]; then
${lines.join("\n")}
  exit 0
fi
exit 1
`
}

async function prepareHealthyVault(vaultPath: string): Promise<void> {
  await configureVaultFolders(vaultPath)
  await copyVaultSeed(vaultPath, { overwrite: false })
  await seedVaultStarterContent(vaultPath)
  await configureCoreSync(vaultPath, "none")
  await configureCommunityPlugins(vaultPath, {
    enabled: true,
    includeGit: false,
    includeMinimalThemeTools: false,
  })
  await configureMinimalTheme(vaultPath, false)
  await configureApp(vaultPath)
  await downloadPlugins(vaultPath, { includeGit: false, includeMinimal: false }, (_repo, _tag, source) =>
    Promise.resolve(new TextEncoder().encode(`asset:${source.name}`)),
  )
}

describe("command flows", () => {
  test("runInit configures a non-interactive vault and patches OpenClaw memory paths", async () => {
    await withTempDir("zettelclaw-run-init-", async (dir) => {
      const vaultPath = join(dir, "vault")
      const workspacePath = join(dir, "workspace", "state")
      const openClawConfigPath = join(dirname(workspacePath), "openclaw.json")
      const originalFetch = globalThis.fetch

      await mkdir(workspacePath, { recursive: true })
      await writeJsonFile(openClawConfigPath, {
        agents: {
          defaults: {
            memorySearch: {
              extraPaths: [],
            },
          },
        },
      })

      globalThis.fetch = async () => new Response(null, { status: 404 })

      try {
        await withEnv(
          { OPENCLAW_CONFIG_PATH: undefined, OPENCLAW_STATE_DIR: undefined, PATH: join(dir, "bin") },
          async () => {
            await runInit({
              yes: true,
              syncMethod: "none",
              theme: "obsidian",
              vaultPath,
              workspacePath,
            })
          },
        )
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(await readJsonFile<Record<string, unknown>>(join(vaultPath, ".obsidian", "app.json"))).toMatchObject({
        livePreview: true,
      })
      expect(await readJsonFile<string[]>(join(vaultPath, ".obsidian", "community-plugins.json"))).toEqual(["calendar"])
      expect(
        await readJsonFile<{
          agents?: {
            defaults?: {
              memorySearch?: {
                extraPaths?: string[]
              }
            }
          }
        }>(openClawConfigPath),
      ).toEqual({
        agents: {
          defaults: {
            memorySearch: {
              extraPaths: [vaultPath],
            },
          },
        },
      })
      expect(await readTextFile(join(dirname(workspacePath), "skills", "zettelclaw", "SKILL.md"))).toContain(
        "# Zettelclaw",
      )
    })
  })

  test("runVerify passes for a healthy vault, OpenClaw config, and QMD setup", async () => {
    await withTempDir("zettelclaw-run-verify-", async (dir) => {
      const vaultPath = join(dir, "vault")
      const workspacePath = join(dir, "workspace", "state")
      const openClawConfigPath = join(dirname(workspacePath), "openclaw.json")
      const binDir = join(dir, "bin")

      await mkdir(workspacePath, { recursive: true })
      await prepareHealthyVault(vaultPath)

      await writeJsonFile(openClawConfigPath, {
        agents: {
          defaults: {
            memorySearch: {
              extraPaths: [vaultPath],
            },
          },
        },
      })
      await writeExecutable(join(binDir, "qmd"), qmdListScript(vaultPath))

      await withEnv({ OPENCLAW_CONFIG_PATH: undefined, OPENCLAW_STATE_DIR: undefined, PATH: binDir }, async () => {
        await expect(
          runVerify({
            yes: true,
            vaultPath,
            workspacePath,
          }),
        ).resolves.toBeUndefined()
      })
    })
  })

  test("runInit overwrites an existing OpenClaw zettelclaw skill install", async () => {
    await withTempDir("zettelclaw-run-init-skill-overwrite-", async (dir) => {
      const vaultPath = join(dir, "vault")
      const workspacePath = join(dir, "workspace", "state")
      const openClawConfigPath = join(dirname(workspacePath), "openclaw.json")
      const skillPath = join(dirname(workspacePath), "skills", "zettelclaw", "SKILL.md")
      const originalFetch = globalThis.fetch

      await mkdir(workspacePath, { recursive: true })
      await writeJsonFile(openClawConfigPath, {
        agents: {
          defaults: {
            memorySearch: {
              extraPaths: [],
            },
          },
        },
      })
      await writeTextFile(skillPath, "old skill")

      globalThis.fetch = async () => new Response(null, { status: 404 })

      try {
        await withEnv(
          { OPENCLAW_CONFIG_PATH: undefined, OPENCLAW_STATE_DIR: undefined, PATH: join(dir, "bin") },
          async () => {
            await runInit({
              yes: true,
              syncMethod: "none",
              theme: "obsidian",
              vaultPath,
              workspacePath,
            })
          },
        )
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(await readTextFile(skillPath)).toContain("# Zettelclaw")
    })
  })

  test("runInit warns but succeeds when OpenClaw skill install fails", async () => {
    await withTempDir("zettelclaw-run-init-skill-warn-", async (dir) => {
      const vaultPath = join(dir, "vault")
      const workspacePath = join(dir, "workspace", "state")
      const openClawConfigPath = join(dirname(workspacePath), "openclaw.json")
      const blockedSkillsPath = join(dirname(workspacePath), "skills")
      const originalFetch = globalThis.fetch

      await mkdir(workspacePath, { recursive: true })
      await writeJsonFile(openClawConfigPath, {
        agents: {
          defaults: {
            memorySearch: {
              extraPaths: [],
            },
          },
        },
      })
      await writeTextFile(blockedSkillsPath, "not a directory")

      globalThis.fetch = async () => new Response(null, { status: 404 })

      try {
        await withEnv(
          { OPENCLAW_CONFIG_PATH: undefined, OPENCLAW_STATE_DIR: undefined, PATH: join(dir, "bin") },
          async () => {
            await expect(
              runInit({
                yes: true,
                syncMethod: "none",
                theme: "obsidian",
                vaultPath,
                workspacePath,
              }),
            ).resolves.toBeUndefined()
          },
        )
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(await readTextFile(blockedSkillsPath)).toBe("not a directory")
      expect(
        await readJsonFile<{
          agents?: {
            defaults?: {
              memorySearch?: {
                extraPaths?: string[]
              }
            }
          }
        }>(openClawConfigPath),
      ).toEqual({
        agents: {
          defaults: {
            memorySearch: {
              extraPaths: [vaultPath],
            },
          },
        },
      })
    })
  })

  test("runInit throws when an explicit workspace path does not exist", async () => {
    await withTempDir("zettelclaw-run-init-missing-workspace-", async (dir) => {
      await expect(
        runInit({
          yes: true,
          syncMethod: "none",
          theme: "obsidian",
          vaultPath: join(dir, "vault"),
          workspacePath: join(dir, "missing-workspace"),
        }),
      ).rejects.toThrow("OpenClaw workspace not found")
    })
  })

  test("runInit configures git sync and the minimal theme defaults", async () => {
    await withTempDir("zettelclaw-run-init-minimal-", async (dir) => {
      const vaultPath = join(dir, "vault")
      const workspacePath = join(dir, "workspace", "state")
      const openClawConfigPath = join(dirname(workspacePath), "openclaw.json")
      const binDir = join(dir, "bin")
      const originalFetch = globalThis.fetch

      await mkdir(workspacePath, { recursive: true })
      await writeJsonFile(openClawConfigPath, {
        agents: {
          defaults: {
            memorySearch: {
              extraPaths: [],
            },
          },
        },
      })
      await writeExecutable(
        join(binDir, "qmd"),
        `#!/bin/sh
echo "qmd unavailable" >&2
exit 1
`,
      )

      globalThis.fetch = async () => new Response(null, { status: 404 })

      try {
        await withEnv(
          {
            OPENCLAW_CONFIG_PATH: undefined,
            OPENCLAW_STATE_DIR: undefined,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
          },
          async () => {
            await runInit({
              yes: true,
              syncMethod: "git",
              theme: "minimal",
              vaultPath,
              workspacePath,
            })
          },
        )
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(await readJsonFile<string[]>(join(vaultPath, ".obsidian", "community-plugins.json"))).toEqual([
        "calendar",
        "obsidian-git",
        "obsidian-minimal-settings",
        "obsidian-hider",
      ])
      expect(
        await readJsonFile<Record<string, unknown>>(join(vaultPath, ".obsidian", "appearance.json")),
      ).toMatchObject({
        cssTheme: "Minimal",
      })
    })
  })

  test("runVerify completes with warnings when workspace and qmd are unavailable", async () => {
    await withTempDir("zettelclaw-run-verify-warn-", async (dir) => {
      const vaultPath = join(dir, "vault")
      await prepareHealthyVault(vaultPath)

      await withEnv(
        { OPENCLAW_CONFIG_PATH: undefined, OPENCLAW_STATE_DIR: undefined, PATH: join(dir, "bin") },
        async () => {
          await expect(
            runVerify({
              yes: true,
              vaultPath,
              workspacePath: join(dir, "missing-workspace"),
            }),
          ).resolves.toBeUndefined()
        },
      )
    })
  })

  test("runVerify fails for broken plugin, settings, and OpenClaw state", async () => {
    await withTempDir("zettelclaw-run-verify-fail-", async (dir) => {
      const vaultPath = join(dir, "vault")
      const workspacePath = join(dir, "workspace", "state")
      const openClawConfigPath = join(dirname(workspacePath), "openclaw.json")

      await mkdir(workspacePath, { recursive: true })
      await configureVaultFolders(vaultPath)
      await writeJsonFile(join(vaultPath, ".obsidian", "app.json"), {
        livePreview: false,
      })
      await writeJsonFile(join(vaultPath, ".obsidian", "workspace.json"), {
        main: {
          type: "tabs",
          stacked: false,
          children: [],
        },
      })
      await writeJsonFile(join(vaultPath, ".obsidian", "appearance.json"), {
        cssTheme: "Minimal",
      })
      await writeJsonFile(join(vaultPath, ".obsidian", "community-plugins.json"), ["obsidian-git"])
      await writeJsonFile(openClawConfigPath, {
        memorySearch: {
          extraPaths: ["/legacy"],
        },
        agents: {
          defaults: {
            memorySearch: {
              extraPaths: ["/elsewhere"],
            },
          },
        },
      })

      await withEnv(
        { OPENCLAW_CONFIG_PATH: undefined, OPENCLAW_STATE_DIR: undefined, PATH: join(dir, "bin") },
        async () => {
          await expect(
            runVerify({
              yes: true,
              vaultPath,
              workspacePath,
            }),
          ).rejects.toThrow("Verification failed with")
        },
      )
    })
  })
})
