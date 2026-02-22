import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import "./helpers/child-process-mock"
import { patchOpenClawConfig } from "../openclaw"

const tempPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true })
    }),
  )
})

async function createConfigFixture(initialConfig: unknown): Promise<{ openclawDir: string; configPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "zettelclaw-openclaw-config-test-"))
  tempPaths.push(root)

  const openclawDir = join(root, ".openclaw")
  const configPath = join(openclawDir, "openclaw.json")

  await mkdir(openclawDir, { recursive: true })
  await writeFile(configPath, `${JSON.stringify(initialConfig, null, 2)}\n`, "utf8")
  return { openclawDir, configPath }
}

describe("patchOpenClawConfig", () => {
  it("migrates memory paths and enforces hook flags", async () => {
    const { openclawDir, configPath } = await createConfigFixture({
      memorySearch: { extraPaths: ["/legacy-path"] },
      agents: { defaults: {} },
      hooks: {
        internal: {
          enabled: false,
          entries: {
            zettelclaw: false,
            "session-memory": true,
          },
        },
      },
    })

    const result = await patchOpenClawConfig("/vault-path", openclawDir)

    expect(result).toEqual({ changed: true })

    const patchedRaw = await readFile(configPath, "utf8")
    const patched = JSON.parse(patchedRaw) as Record<string, unknown>

    expect("memorySearch" in patched).toBe(false)

    const defaultsExtraPaths = (
      ((patched.agents as Record<string, unknown>)?.defaults as Record<string, unknown>)?.memorySearch as Record<
        string,
        unknown
      >
    )?.extraPaths as string[]

    expect(defaultsExtraPaths).toEqual(expect.arrayContaining(["/legacy-path", "/vault-path"]))

    const hooks = patched.hooks as Record<string, unknown>
    const internal = hooks.internal as Record<string, unknown>
    const entries = internal.entries as Record<string, unknown>

    expect(internal.enabled).toBe(true)
    expect((entries.zettelclaw as Record<string, unknown>).enabled).toBe(true)
    expect((entries["session-memory"] as Record<string, unknown>).enabled).toBe(false)
  })

  it("is idempotent after first patch", async () => {
    const { openclawDir } = await createConfigFixture({
      agents: {
        defaults: {
          memorySearch: {
            extraPaths: ["/vault-path"],
          },
        },
      },
      hooks: {
        internal: {
          enabled: true,
          entries: {
            zettelclaw: { enabled: true },
            "session-memory": { enabled: false },
          },
        },
      },
    })

    const first = await patchOpenClawConfig("/vault-path", openclawDir)
    const second = await patchOpenClawConfig("/vault-path", openclawDir)

    expect(first).toEqual({ changed: false })
    expect(second).toEqual({ changed: false })
  })

  it("returns a descriptive error when config JSON is invalid", async () => {
    const { openclawDir, configPath } = await createConfigFixture({})
    await writeFile(configPath, "{invalid-json", "utf8")

    const result = await patchOpenClawConfig("/vault-path", openclawDir)
    expect(result.changed).toBe(false)
    expect(result.message).toContain("Could not patch")
  })
})
