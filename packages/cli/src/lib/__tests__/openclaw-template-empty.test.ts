import { describe, expect, it } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { ensureZettelclawNightlyMaintenanceCronJob } from "../openclaw"
import { resolveSkillPackageDir } from "../skill"

describe("openclaw empty nightly template", () => {
  it("fails when rendered maintenance message is empty", async () => {
    const templatePath = join(resolveSkillPackageDir(), "templates", "nightly-maintenance-event.md")
    const original = await readFile(templatePath, "utf8")

    await writeFile(templatePath, "   \n", "utf8")

    try {
      const result = await ensureZettelclawNightlyMaintenanceCronJob("/vault")
      expect(result.status).toBe("failed")
      expect(result.message).toContain("rendered an empty maintenance message")
    } finally {
      await writeFile(templatePath, original, "utf8")
    }
  })
})
