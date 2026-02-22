import { beforeAll, beforeEach, describe, expect, it } from "bun:test"

import { resetSpawnSyncMock, spawnSyncMock } from "./helpers/child-process-mock"

let runOpenClawCommand: typeof import("../openclaw-command").runOpenClawCommand
let parseJson: typeof import("../openclaw-command").parseJson

beforeAll(async () => {
  const loaded = await import("../openclaw-command")
  runOpenClawCommand = loaded.runOpenClawCommand
  parseJson = loaded.parseJson
})

beforeEach(() => {
  resetSpawnSyncMock()
})

describe("runOpenClawCommand", () => {
  it("returns ok for successful commands", () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '{"ok":true}',
      stderr: "",
    })

    const result = runOpenClawCommand(["cron", "list", "--json"])

    expect(result.ok).toBe(true)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('{"ok":true}')
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "openclaw",
      ["cron", "list", "--json"],
      expect.objectContaining({ encoding: "utf8", timeout: 30_000 }),
    )
  })

  it("surfaces stderr on failure", () => {
    spawnSyncMock.mockReturnValue({
      status: 2,
      stdout: "",
      stderr: "permission denied",
    })

    const result = runOpenClawCommand(["cron", "list", "--json"])

    expect(result.ok).toBe(false)
    expect(result.status).toBe(2)
    expect(result.message).toBe("permission denied")
  })

  it("falls back to stdout when stderr is empty", () => {
    spawnSyncMock.mockReturnValue({
      status: 2,
      stdout: "stdout failure",
      stderr: "",
    })

    const result = runOpenClawCommand(["cron", "list", "--json"])
    expect(result.ok).toBe(false)
    expect(result.message).toBe("stdout failure")
  })

  it("falls back to a generic exit-code message when no output is available", () => {
    spawnSyncMock.mockReturnValue({
      status: 7,
      stdout: "",
      stderr: "",
    })

    const result = runOpenClawCommand(["cron", "list"])
    expect(result.ok).toBe(false)
    expect(result.message).toBe("openclaw cron list exited with code 7")
  })

  it("returns error metadata when spawnSync throws ENOENT", () => {
    const error = new Error("spawn openclaw ENOENT") as Error & { code?: string }
    error.code = "ENOENT"

    spawnSyncMock.mockReturnValue({
      status: null,
      stdout: "",
      stderr: "",
      error,
    })

    const result = runOpenClawCommand(["cron", "list", "--json"])

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("ENOENT")
    expect(result.message).toBe("spawn openclaw ENOENT")
    expect(result.status).toBe(1)
  })

  it("uses the default mock spawn shape when no explicit response is configured", () => {
    const result = runOpenClawCommand(["cron", "list"])
    expect(result.ok).toBe(true)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })
})

describe("parseJson", () => {
  it("parses valid JSON", () => {
    const parsed = parseJson<{ ok: boolean }>('{"ok":true}')
    expect(parsed.value).toEqual({ ok: true })
    expect(parsed.error).toBeUndefined()
  })

  it("returns an error for malformed JSON", () => {
    const parsed = parseJson<{ ok: boolean }>("{invalid")
    expect(parsed.value).toBeUndefined()
    expect(typeof parsed.error).toBe("string")
  })
})
