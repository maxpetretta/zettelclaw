import { describe, expect, it, mock } from "bun:test"

let importNonce = 0

function loadSkillModule(input: { packageResolve: (id: string) => string; existsSync: (path: string) => boolean }) {
  mock.module("node:module", () => ({
    createRequire: () => ({
      resolve: input.packageResolve,
    }),
  }))

  mock.module("node:fs", () => ({
    existsSync: input.existsSync,
  }))

  importNonce += 1
  return import(`../skill.ts?test=${String(importNonce)}`)
}

describe("skill resolution", () => {
  it("uses package resolution when @zettelclaw/skill is resolvable", async () => {
    const skill = await loadSkillModule({
      packageResolve: () => "/virtual/skill/package.json",
      existsSync: () => false,
    })

    expect(skill.resolveSkillPackageDir()).toBe("/virtual/skill")
    expect(skill.resolveSkillPath("templates", "a.md")).toBe("/virtual/skill/templates/a.md")
  })

  it("falls back to local bundled candidates when package resolution fails", async () => {
    const skill = await loadSkillModule({
      packageResolve: () => {
        throw new Error("not found")
      },
      existsSync: (path) => path.endsWith("SKILL.md") || path.endsWith("hooks"),
    })

    const resolved = skill.resolveSkillPackageDir()
    expect(resolved.endsWith("packages/cli/skill")).toBe(true)

    // Verify cached return path is stable.
    expect(skill.resolveSkillPackageDir()).toBe(resolved)
  })

  it("throws when no skill candidates are valid", async () => {
    const skill = await loadSkillModule({
      packageResolve: () => {
        throw new Error("not found")
      },
      existsSync: () => false,
    })

    expect(() => skill.resolveSkillPackageDir()).toThrow("Could not resolve Zettelclaw skill package")
  })
})
