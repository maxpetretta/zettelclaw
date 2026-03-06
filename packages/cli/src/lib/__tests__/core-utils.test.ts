import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { chooseDirectoryBackupPath, chooseFileBackupPath } from "../backups"
import { toTildePath } from "../cli"
import { forEachConcurrent } from "../concurrency"
import { FOLDERS, getVaultFolders } from "../folders"
import { asRecord, asStringArray } from "../json"
import { resolveOpenClawEnvForWorkspace } from "../openclaw-workspace"
import { expandHome, resolveUserPath } from "../paths"
import { resolveSkillPath } from "../skill"
import { substituteTemplate } from "../template"
import { uniqueTrimmedStrings } from "../text"
import { withTempDir, writeTextFile } from "./test-helpers"

describe("core utility modules", () => {
  test("json helpers normalize values", () => {
    expect(asRecord({ foo: "bar" })).toEqual({ foo: "bar" })
    expect(asRecord(["nope"])).toEqual({})
    expect(asStringArray(["a", 1, "b", null])).toEqual(["a", "b"])
    expect(asStringArray("nope")).toEqual([])
  })

  test("path helpers expand home paths and resolve absolutes", () => {
    expect(expandHome("~")).toBe(resolveUserPath("~"))
    expect(expandHome("~/vault")).toBe(resolveUserPath("~/vault"))
    expect(resolveUserPath("./packages/cli")).toContain("/packages/cli")
  })

  test("toTildePath shortens home-prefixed paths", () => {
    const home = process.env.HOME ?? ""
    expect(toTildePath(join(home, "zettelclaw"))).toBe("~/zettelclaw")
    expect(toTildePath("/tmp/zettelclaw")).toBe("/tmp/zettelclaw")
  })

  test("text helpers trim and de-duplicate case-insensitively", () => {
    expect(uniqueTrimmedStrings([" Alpha ", "alpha", "BETA", "", " beta "])).toEqual(["Alpha", "BETA"])
  })

  test("template substitution replaces placeholders", () => {
    expect(substituteTemplate("Hello {{name}} from {{place}}", { name: "Max", place: "Detroit" })).toBe(
      "Hello Max from Detroit",
    )
  })

  test("folder helpers return canonical folder map", () => {
    expect(getVaultFolders()).toEqual(FOLDERS)
  })

  test("backup helpers choose numbered backup paths", async () => {
    await withTempDir("zettelclaw-backups-", async (dir) => {
      const sourcePath = join(dir, "note.md")
      await writeTextFile(sourcePath, "hello")
      await writeTextFile(`${sourcePath}.bak`, "existing")

      await expect(chooseFileBackupPath(sourcePath)).resolves.toEqual({
        backupPath: join(dir, "note.md.bak.1"),
        label: "note.md.bak.1",
      })

      await writeTextFile(join(dir, "folder.bak"), "")
      await expect(chooseDirectoryBackupPath(dir, "folder")).resolves.toEqual({
        backupPath: join(dir, "folder.bak.1"),
        label: "folder.bak.1",
      })
    })
  })

  test("concurrency helper visits each item once while respecting work", async () => {
    const visited: Array<[number, number]> = []
    let active = 0
    let maxActive = 0

    await forEachConcurrent([10, 20, 30, 40], 2, async (value, index) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      visited.push([index, value])
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
    })

    expect(maxActive).toBeLessThanOrEqual(2)
    expect(visited.sort((left, right) => left[0] - right[0])).toEqual([
      [0, 10],
      [1, 20],
      [2, 30],
      [3, 40],
    ])
  })

  test("openclaw workspace helper derives state/config paths", () => {
    expect(resolveOpenClawEnvForWorkspace("/tmp/openclaw/workspace")).toEqual({
      stateDir: "/tmp/openclaw",
      configPath: "/tmp/openclaw/openclaw.json",
    })
  })

  test("skill path resolves to bundled skill assets", () => {
    expect(resolveSkillPath("SKILL.md")).toContain("/skill/SKILL.md")
  })
})
