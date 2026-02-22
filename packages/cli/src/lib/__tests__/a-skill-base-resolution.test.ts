import { describe, expect, it, mock } from "bun:test"

mock.module("node:module", () => ({
  createRequire: () => ({
    resolve: () => {
      throw new Error("package not found")
    },
  }),
}))

mock.module("node:fs", () => ({
  existsSync: (path: string) => {
    const normalized = String(path).replace(/\\/g, "/")
    if (!normalized.includes("/packages/skill/")) {
      return false
    }

    return normalized.endsWith("/SKILL.md") || normalized.endsWith("/hooks")
  },
}))

import { resolveSkillPackageDir } from "../skill"

// Restore module mocks immediately after loading the target module.
mock.restore()

describe("base skill module resolution", () => {
  it("falls back to the shared skill package path", () => {
    expect(resolveSkillPackageDir().replace(/\\/g, "/").endsWith("/packages/skill")).toBe(true)
  })
})
