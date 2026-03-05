import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { configureApp } from "../vault-obsidian"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempVault(): Promise<string> {
  const vaultPath = await mkdtemp(join(tmpdir(), "zettelclaw-vault-"))
  tempDirs.push(vaultPath)
  await mkdir(join(vaultPath, ".obsidian"), { recursive: true })
  return vaultPath
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
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
})
