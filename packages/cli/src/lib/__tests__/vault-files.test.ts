import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import { substituteTemplate } from "../template"
import { configureVaultFolders } from "../vault-folders"
import { isDirectory, pathExists, readJsonFileOrDefault, walkFiles, writeFileIfMissing } from "../vault-fs"
import { copyVaultSeed, seedVaultStarterContent } from "../vault-seed"
import { readTextFile, withTempDir, writeTextFile } from "./test-helpers"

describe("vault filesystem and seed content", () => {
  test("vault-fs helpers read and write expected files", async () => {
    await withTempDir("zettelclaw-vault-fs-", async (dir) => {
      const nestedFile = join(dir, "nested", "note.md")
      await writeFileIfMissing(nestedFile, "hello")
      await writeFileIfMissing(nestedFile, "changed")

      await expect(pathExists(nestedFile)).resolves.toBe(true)
      await expect(isDirectory(join(dir, "nested"))).resolves.toBe(true)
      await expect(readTextFile(nestedFile)).resolves.toBe("hello")
      await expect(walkFiles(dir)).resolves.toContain("nested/note.md")
      await expect(readJsonFileOrDefault(join(dir, "missing.json"), { ok: true })).resolves.toEqual({ ok: true })
    })
  })

  test("configureVaultFolders creates the canonical vault folders", async () => {
    await withTempDir("zettelclaw-vault-folders-", async (dir) => {
      await mkdir(join(dir, "scratch"), { recursive: true })

      await configureVaultFolders(dir)

      await expect(isDirectory(join(dir, "00 Inbox"))).resolves.toBe(true)
      await expect(isDirectory(join(dir, "01 Notes"))).resolves.toBe(true)
      await expect(isDirectory(join(dir, "02 Journal"))).resolves.toBe(true)
      await expect(isDirectory(join(dir, "03 Templates"))).resolves.toBe(true)
      await expect(isDirectory(join(dir, "04 Attachments"))).resolves.toBe(true)
      await expect(isDirectory(join(dir, "scratch"))).resolves.toBe(true)
    })
  })

  test("copyVaultSeed copies the canonical seed files", async () => {
    await withTempDir("zettelclaw-vault-seed-", async (dir) => {
      const result = await copyVaultSeed(dir, { overwrite: false })

      expect(result.failed).toEqual([])
      expect(result.added).toContain(".obsidian/workspace.json")
      expect(result.added).toContain("03 Templates/note.md")
      expect(result.added).toContain("04 Attachments/.gitkeep")
      await expect(pathExists(join(dir, ".obsidian", "workspace.json"))).resolves.toBe(true)
    })
  })

  test("copyVaultSeed respects existing files when overwrite is false", async () => {
    await withTempDir("zettelclaw-vault-seed-skip-", async (dir) => {
      await writeTextFile(join(dir, "README.md"), "existing")

      const result = await copyVaultSeed(dir, { overwrite: false })

      expect(result.skipped).toContain("README.md")
      await expect(readTextFile(join(dir, "README.md"))).resolves.toBe("existing")
    })
  })

  test("seedVaultStarterContent creates starter notes once", async () => {
    await withTempDir("zettelclaw-vault-starters-", async (dir) => {
      await configureVaultFolders(dir)
      await copyVaultSeed(dir, { overwrite: false })
      await seedVaultStarterContent(dir)

      const firstPass = await walkFiles(dir)
      expect(firstPass.some((path) => path === "01 Notes/Zettelclaw Vault Principles.md")).toBe(true)
      expect(firstPass.some((path) => path === "00 Inbox/Build A Capture Habit.md")).toBe(true)
      expect(firstPass.some((path) => path.startsWith("02 Journal/") && path.endsWith(".md"))).toBe(true)

      const journalPath = firstPass.find((path) => path.startsWith("02 Journal/") && path.endsWith(".md"))
      expect(journalPath).toBeDefined()
      if (!journalPath) {
        return
      }

      const journalTemplate = await readTextFile(join(dir, "03 Templates", "journal.md"))
      expect(await readTextFile(join(dir, journalPath))).toBe(
        substituteTemplate(journalTemplate, {
          "date:YYYY-MM-DD": journalPath.replace("02 Journal/", "").replace(".md", ""),
        }),
      )

      await writeTextFile(join(dir, journalPath), "preserve")
      await seedVaultStarterContent(dir)

      await expect(readTextFile(join(dir, journalPath))).resolves.toBe("preserve")
    })
  })
})
