import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveSkillPackageDir, resolveSkillPath } from "../skill"
import { substituteTemplate } from "../template"
import { resetSpawnSyncMock, spawnSyncMock } from "./helpers/child-process-mock"

let installOpenClawHook: typeof import("../openclaw").installOpenClawHook
let ensureZettelclawNightlyMaintenanceCronJob: typeof import("../openclaw").ensureZettelclawNightlyMaintenanceCronJob
let firePostInitEvent: typeof import("../openclaw").firePostInitEvent

beforeAll(async () => {
  const loaded = await import("../openclaw")
  installOpenClawHook = loaded.installOpenClawHook
  ensureZettelclawNightlyMaintenanceCronJob = loaded.ensureZettelclawNightlyMaintenanceCronJob
  firePostInitEvent = loaded.firePostInitEvent
})

const tempPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true })
    }),
  )
})

beforeEach(() => {
  resetSpawnSyncMock()
})

async function buildNightlyMessage(vaultPath: string): Promise<string> {
  const templatePath = resolveSkillPath("templates", "nightly-maintenance-event.md")
  const template = await readFile(templatePath, "utf8")
  return substituteTemplate(template, {
    VAULT_PATH: vaultPath,
    SKILL_PACKAGE_PATH: resolveSkillPackageDir(),
  }).trim()
}

describe("installOpenClawHook", () => {
  it("installs hook files and skips when already current", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-openclaw-install-test-"))
    tempPaths.push(root)

    const first = await installOpenClawHook(root)
    expect(first).toEqual({ status: "installed" })

    const hookManifestPath = join(root, "hooks", "zettelclaw", "HOOK.md")
    const handlerPath = join(root, "hooks", "zettelclaw", "handler.ts")

    expect((await stat(hookManifestPath)).isFile()).toBe(true)
    expect((await stat(handlerPath)).isFile()).toBe(true)

    const second = await installOpenClawHook(root)
    expect(second).toEqual({ status: "skipped" })
  })

  it("returns failed when target path cannot be created", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-openclaw-install-test-"))
    tempPaths.push(root)

    const blocked = join(root, "blocked")
    await writeFile(blocked, "not-a-directory", "utf8")

    const result = await installOpenClawHook(blocked)

    expect(result.status).toBe("failed")
    expect(result.message).toContain("Could not install hook")
  })

  it("reinstalls when an existing hook differs from bundled content", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-openclaw-install-test-"))
    tempPaths.push(root)

    await installOpenClawHook(root)

    const handlerPath = join(root, "hooks", "zettelclaw", "handler.ts")
    const original = await readFile(handlerPath, "utf8")
    await writeFile(handlerPath, `${original}\n// drift\n`, "utf8")

    const result = await installOpenClawHook(root)
    expect(result).toEqual({ status: "installed" })

    const rewritten = await readFile(handlerPath, "utf8")
    expect(rewritten.endsWith("// drift\n")).toBe(false)
  })
})

describe("ensureZettelclawNightlyMaintenanceCronJob", () => {
  it("creates a nightly cron job when missing", async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ jobs: [] }), stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"nightly-1"}', stderr: "" })

    const result = await ensureZettelclawNightlyMaintenanceCronJob("/vault")

    expect(result).toEqual({ status: "installed" })
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)

    const addArgs = spawnSyncMock.mock.calls[1]?.[1]
    expect(addArgs).toEqual(expect.arrayContaining(["cron", "add", "--name", "zettelclaw-nightly", "--json"]))
  })

  it("enables an existing disabled matching nightly job", async () => {
    const vaultPath = "/vault"
    const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    const maintenanceMessage = await buildNightlyMessage(vaultPath)

    spawnSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          jobs: [
            {
              id: "nightly-disabled",
              name: "zettelclaw-nightly",
              enabled: false,
              cron: "0 3 * * *",
              tz: localTimeZone,
              session: "isolated",
              message: maintenanceMessage,
            },
          ],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })

    const result = await ensureZettelclawNightlyMaintenanceCronJob(vaultPath)

    expect(result).toEqual({ status: "installed" })
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
    expect(spawnSyncMock.mock.calls[1]?.[1]).toEqual(["cron", "enable", "nightly-disabled"])
  })

  it("fails when cron list output is invalid JSON", async () => {
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: "not-json", stderr: "" })

    const result = await ensureZettelclawNightlyMaintenanceCronJob("/vault")

    expect(result.status).toBe("failed")
    expect(result.message).toContain("Could not parse cron jobs JSON")
  })

  it("fails when cron list command fails", async () => {
    spawnSyncMock.mockReturnValueOnce({ status: 1, stdout: "", stderr: "list failed" })

    const result = await ensureZettelclawNightlyMaintenanceCronJob("/vault")
    expect(result.status).toBe("failed")
    expect(result.message).toContain("Could not list cron jobs")
  })

  it("falls back to UTC when local timezone is unavailable", async () => {
    const originalDateTimeFormat = Intl.DateTimeFormat

    ;(Intl as typeof Intl & { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat = (() => ({
      resolvedOptions() {
        return {
          locale: "en-US",
          calendar: "gregory",
          numberingSystem: "latn",
          timeZone: "   ",
        } as Intl.ResolvedDateTimeFormatOptions
      },
    })) as unknown as typeof Intl.DateTimeFormat

    try {
      spawnSyncMock
        .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ jobs: [] }), stderr: "" })
        .mockReturnValueOnce({ status: 0, stdout: '{"id":"nightly-utc"}', stderr: "" })

      const result = await ensureZettelclawNightlyMaintenanceCronJob("/vault")
      expect(result).toEqual({ status: "installed" })

      const addArgs = spawnSyncMock.mock.calls[1]?.[1] ?? []
      const tzIndex = addArgs.indexOf("--tz")
      expect(tzIndex).toBeGreaterThanOrEqual(0)
      expect(addArgs[tzIndex + 1]).toBe("UTC")
    } finally {
      ;(Intl as typeof Intl & { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat = originalDateTimeFormat
    }
  })
})

describe("firePostInitEvent", () => {
  it("succeeds on the direct --mode now call", async () => {
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"ok":true}', stderr: "" })

    const result = await firePostInitEvent("/vault")

    expect(result).toEqual({ sent: true })
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
    expect(spawnSyncMock.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["system", "event", "--mode", "now"]))
  })

  it("falls back to legacy system event call", async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "mode not supported" })
      .mockReturnValueOnce({ status: 0, stdout: '{"ok":true}', stderr: "" })

    const result = await firePostInitEvent("/vault")

    expect(result).toEqual({ sent: true })
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
    expect(spawnSyncMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(["system", "event", "--text"]))
  })

  it("returns a failure when both event calls fail", async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "direct failed" })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "fallback failed" })

    const result = await firePostInitEvent("/vault")

    expect(result.sent).toBe(false)
    expect(result.message).toContain("Could not fire post-init event")
  })
})
