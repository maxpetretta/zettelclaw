import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { seedVaultStarterContent } from "../vault-seed"

const tempPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true })
    }),
  )
})

describe("seedVaultStarterContent", () => {
  it("creates starter journal with Log/Todo sections", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-vault-seed-test-"))
    tempPaths.push(root)

    await seedVaultStarterContent(root, true)

    const journalEntries = await readdir(join(root, "03 Journal"))
    const journalFilename = journalEntries.find((entry) => entry.endsWith(".md"))
    expect(journalFilename).toBeDefined()

    const journalContent = await readFile(join(root, "03 Journal", journalFilename as string), "utf8")
    expect(journalContent).toContain("## Log")
    expect(journalContent).toContain("## Todo")
    expect(journalContent).not.toContain("## Done")
    expect(journalContent).not.toContain("## Decisions")
    expect(journalContent).not.toContain("## Facts")
    expect(journalContent).not.toContain("## Open")
  })

  it("documents Log/Todo capture in starter evergreen note", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-vault-seed-test-"))
    tempPaths.push(root)

    await seedVaultStarterContent(root, true)

    const noteContent = await readFile(join(root, "01 Notes", "Zettelclaw Is Shared Human + Agent Memory.md"), "utf8")
    expect(noteContent).toContain("append structured bullets (`Log`, `Todo`) into daily journal notes.")
  })
})
