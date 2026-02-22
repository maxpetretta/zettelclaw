import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readOpenClawConfigFile } from "../openclaw-config"

const tempPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true })
    }),
  )
})

describe("readOpenClawConfigFile", () => {
  it("returns an explicit error for missing files", async () => {
    const missingPath = join(tmpdir(), "zettelclaw-no-such-config.json")
    const result = await readOpenClawConfigFile(missingPath)

    expect(result.config).toBeUndefined()
    expect(result.error).toContain("OpenClaw config not found")
  })

  it("returns a parse error for invalid JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-config-file-test-"))
    tempPaths.push(root)

    const configPath = join(root, "openclaw.json")
    await writeFile(configPath, "{invalid", "utf8")

    const result = await readOpenClawConfigFile(configPath)
    expect(result.config).toBeUndefined()
    expect(result.error).toContain("Could not parse JSON")
  })

  it("reads and returns config JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-config-file-test-"))
    tempPaths.push(root)

    const configPath = join(root, "openclaw.json")
    await writeFile(configPath, JSON.stringify({ hooks: { internal: { enabled: true } } }), "utf8")

    const result = await readOpenClawConfigFile(configPath)
    expect(result.error).toBeUndefined()
    expect(result.config).toEqual({ hooks: { internal: { enabled: true } } })
  })

  it("surfaces read errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-config-file-test-"))
    tempPaths.push(root)

    // Directory exists, so access() passes; readFile() then throws EISDIR.
    const result = await readOpenClawConfigFile(root)
    expect(result.config).toBeUndefined()
    expect(typeof result.error).toBe("string")
    expect(result.error).toContain("Could not read")
  })
})
