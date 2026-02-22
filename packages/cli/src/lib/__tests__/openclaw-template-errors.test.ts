import { describe, expect, it } from "bun:test"
import { rename } from "node:fs/promises"
import { join } from "node:path"

import { ensureZettelclawNightlyMaintenanceCronJob, firePostInitEvent } from "../openclaw"
import { resolveSkillPackageDir } from "../skill"

async function withTemporarilyRenamedFile<T>(pathToFile: string, run: () => Promise<T>): Promise<T> {
  const backupPath = `${pathToFile}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  await rename(pathToFile, backupPath)

  try {
    return await run()
  } finally {
    await rename(backupPath, pathToFile)
  }
}

describe("openclaw template read errors", () => {
  it("fails nightly cron setup when template cannot be read", async () => {
    const templatePath = join(resolveSkillPackageDir(), "templates", "nightly-maintenance-event.md")

    const result = await withTemporarilyRenamedFile(templatePath, async () =>
      ensureZettelclawNightlyMaintenanceCronJob("/vault"),
    )

    expect(result.status).toBe("failed")
    expect(result.message).toContain("Could not read template")
  })

  it("fails post-init event when template cannot be read", async () => {
    const templatePath = join(resolveSkillPackageDir(), "templates", "post-init-event.md")

    const result = await withTemporarilyRenamedFile(templatePath, async () => firePostInitEvent("/vault"))

    expect(result.sent).toBe(false)
    expect(result.message).toContain("Could not read template")
  })
})
