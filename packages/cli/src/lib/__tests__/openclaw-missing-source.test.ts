import { describe, expect, it } from "bun:test"
import { rename } from "node:fs/promises"
import { join } from "node:path"

import { installOpenClawHook } from "../openclaw"
import { resolveSkillPackageDir } from "../skill"

describe("openclaw missing bundled hook source", () => {
  it("fails fast when the bundled hook source is absent", async () => {
    const sourcePath = join(resolveSkillPackageDir(), "hooks", "zettelclaw")
    const backupPath = `${sourcePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`

    await rename(sourcePath, backupPath)

    try {
      const result = await installOpenClawHook("/tmp/openclaw")
      expect(result.status).toBe("failed")
      expect(result.message).toContain("Missing bundled hook")
    } finally {
      await rename(backupPath, sourcePath)
    }
  })
})
