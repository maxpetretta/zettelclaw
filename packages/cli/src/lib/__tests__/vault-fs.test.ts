import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  isDirectory,
  pathExists,
  readJsonFileOrDefault,
  removePathIfExists,
  walkFiles,
  writeFileIfMissing,
  writeJsonFile,
} from "../vault-fs"

const tempPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true })
    }),
  )
})

describe("vault-fs helpers", () => {
  it("detects path existence and directory status", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-vault-fs-test-"))
    tempPaths.push(root)

    const filePath = join(root, "file.txt")
    await writeFile(filePath, "hello", "utf8")

    expect(await pathExists(root)).toBe(true)
    expect(await pathExists(filePath)).toBe(true)
    expect(await pathExists(join(root, "missing.txt"))).toBe(false)

    expect(await isDirectory(root)).toBe(true)
    expect(await isDirectory(filePath)).toBe(false)
  })

  it("walks files recursively and removes directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-vault-fs-walk-"))
    tempPaths.push(root)

    await mkdir(join(root, "a", "b"), { recursive: true })
    await writeFile(join(root, "top.md"), "x", "utf8")
    await writeFile(join(root, "a", "nested.md"), "x", "utf8")
    await writeFile(join(root, "a", "b", "deep.md"), "x", "utf8")

    const files = (await walkFiles(root)).sort((left, right) => left.localeCompare(right))
    expect(files).toEqual(["a/b/deep.md", "a/nested.md", "top.md"])

    await removePathIfExists(root)
    expect(await pathExists(root)).toBe(false)
  })

  it("writes files only when missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-vault-fs-write-"))
    tempPaths.push(root)

    const filePath = join(root, "notes", "seed.md")

    await writeFileIfMissing(filePath, "first")
    await writeFileIfMissing(filePath, "second")

    const saved = await readFile(filePath, "utf8")
    expect(saved).toBe("first")
  })

  it("reads JSON with default fallback and writes formatted JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-vault-fs-json-"))
    tempPaths.push(root)

    const jsonPath = join(root, "config.json")
    const missingPath = join(root, "missing.json")

    expect(await readJsonFileOrDefault(missingPath, { fallback: true })).toEqual({ fallback: true })

    await writeJsonFile(jsonPath, { a: 1, b: "two" })

    const parsed = await readJsonFileOrDefault<Record<string, unknown>>(jsonPath, { fallback: false })
    expect(parsed).toEqual({ a: 1, b: "two" })

    const raw = await readFile(jsonPath, "utf8")
    expect(raw.endsWith("\n")).toBe(true)
  })
})
