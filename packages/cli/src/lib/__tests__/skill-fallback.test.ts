import { afterEach, describe, expect, it, mock } from "bun:test"

let importNonce = 0

function loadSkillModuleForFallback() {
  mock.module("node:module", () => ({
    createRequire: () => ({
      resolve: () => {
        throw new Error("package not found")
      },
    }),
  }))

  mock.module("node:fs", () => ({
    existsSync: (path: string) => path.endsWith("SKILL.md") || path.endsWith("hooks"),
  }))

  importNonce += 1
  return import(`../skill.ts?fallback=${String(importNonce)}`)
}

afterEach(() => {
  mock.restore()
})

describe("skill fallback resolution", () => {
  it("uses fallback skill candidates and caches the result", async () => {
    const skill = await loadSkillModuleForFallback()
    const first = skill.resolveSkillPackageDir()
    const second = skill.resolveSkillPackageDir()

    expect(first).toBe(second)
    expect(first.endsWith("packages/cli/skill")).toBe(true)
    expect(skill.resolveSkillPath("templates")).toBe(`${first}/templates`)
  })
})
