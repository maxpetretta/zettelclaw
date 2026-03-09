import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { toTildePath } from "../cli"
import { FOLDERS } from "../folders"
import { asRecord, asStringArray } from "../json"
import { installOpenClawSkillForWorkspace, resolveOpenClawSkillInstallPath } from "../openclaw-skill"
import { expandHome, resolveUserPath } from "../paths"
import { substituteTemplate } from "../template"
import { readTextFile, withTempDir, writeTextFile } from "./test-helpers"

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

  test("template substitution replaces placeholders", () => {
    expect(substituteTemplate("Hello {{name}} from {{place}}", { name: "Max", place: "Detroit" })).toBe(
      "Hello Max from Detroit",
    )
  })

  test("folders constant provides canonical folder map", () => {
    expect(FOLDERS).toEqual({
      inbox: "00 Inbox",
      notes: "01 Notes",
      journal: "02 Journal",
      templates: "03 Templates",
      attachments: "04 Attachments",
    })
  })

  test("openclaw skill helper installs the bundled skill into managed skills", async () => {
    await withTempDir("zettelclaw-openclaw-skill-", async (dir) => {
      const workspacePath = join(dir, "workspace", "state")
      const installedPath = resolveOpenClawSkillInstallPath(join(dir, "workspace"))

      await writeTextFile(join(installedPath, "SKILL.md"), "old skill")

      const result = await installOpenClawSkillForWorkspace(workspacePath)

      expect(result.installedPath).toBe(installedPath)
      expect(result.sourcePath).toContain("/skill")
      expect(await readTextFile(join(installedPath, "SKILL.md"))).toContain("# Zettelclaw")
    })
  })
})
