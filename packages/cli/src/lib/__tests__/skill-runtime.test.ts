import { describe, expect, it } from "bun:test"

import { resolveSkillPackageDir, resolveSkillPath } from "../skill"

describe("skill runtime resolution", () => {
  it("returns a stable cached skill path", () => {
    const first = resolveSkillPackageDir()
    const second = resolveSkillPackageDir()

    expect(second).toBe(first)
    expect(resolveSkillPath("templates")).toBe(`${first}/templates`)
  })
})
