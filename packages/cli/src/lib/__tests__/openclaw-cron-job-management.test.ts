import { beforeAll, beforeEach, describe, expect, it } from "bun:test"

import { resetSpawnSyncMock, spawnSyncMock } from "./helpers/child-process-mock"

let ensureZettelclawSweepCronJob: typeof import("../openclaw").ensureZettelclawSweepCronJob

beforeAll(async () => {
  const loaded = await import("../openclaw")
  ensureZettelclawSweepCronJob = loaded.ensureZettelclawSweepCronJob
})

beforeEach(() => {
  resetSpawnSyncMock()
})

describe("ensureZettelclawSweepCronJob", () => {
  it("returns skipped when a matching enabled job already exists", () => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        jobs: [
          {
            id: "job-1",
            name: "zettelclaw-reset",
            enabled: true,
            cron: "0 2 * * *",
            tz: timeZone,
            session: "isolated",
            message: "/reset",
          },
        ],
      }),
      stderr: "",
    })

    const result = ensureZettelclawSweepCronJob()

    expect(result).toEqual({ status: "skipped" })
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
  })

  it("disables legacy enabled jobs and creates a replacement", () => {
    spawnSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          jobs: [
            {
              id: "legacy-1",
              name: "zettelclaw-reset",
              enabled: true,
              cron: "*/5 * * * *",
              tz: "UTC",
              session: "default",
              message: "old",
            },
          ],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"new-1"}', stderr: "" })

    const result = ensureZettelclawSweepCronJob()

    expect(result).toEqual({ status: "installed" })
    expect(spawnSyncMock).toHaveBeenCalledTimes(3)

    expect(spawnSyncMock.mock.calls[1]?.[1]).toEqual(["cron", "disable", "legacy-1"])

    const addArgs = spawnSyncMock.mock.calls[2]?.[1]
    expect(addArgs).toEqual(expect.arrayContaining(["cron", "add", "--name", "zettelclaw-reset", "--json"]))
  })

  it("fails when cron list returns invalid JSON", () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "{invalid",
      stderr: "",
    })

    const result = ensureZettelclawSweepCronJob()
    expect(result.status).toBe("failed")
    expect(result.message).toContain("Could not parse cron jobs JSON")
  })

  it("fails when a legacy enabled job has no id", () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        jobs: [
          {
            name: "zettelclaw-reset",
            enabled: true,
            cron: "*/10 * * * *",
            session: "isolated",
            message: "/reset",
          },
        ],
      }),
      stderr: "",
    })

    const result = ensureZettelclawSweepCronJob()
    expect(result.status).toBe("failed")
    expect(result.message).toContain("without an id")
  })

  it("fails when disabling a legacy job fails", () => {
    spawnSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          jobs: [
            {
              id: "legacy-2",
              name: "zettelclaw-reset",
              enabled: true,
              cron: "*/10 * * * *",
              session: "isolated",
              message: "/reset",
            },
          ],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "disable failed" })

    const result = ensureZettelclawSweepCronJob()
    expect(result.status).toBe("failed")
    expect(result.message).toContain("Could not disable legacy")
  })

  it("enables matching disabled jobs before creating new ones", () => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

    spawnSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          jobs: [
            {
              id: "disabled-1",
              name: "zettelclaw-reset",
              enabled: false,
              cron: "0 2 * * *",
              tz: timeZone,
              session: "isolated",
              message: "/reset",
            },
          ],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })

    const result = ensureZettelclawSweepCronJob()
    expect(result).toEqual({ status: "installed" })
    expect(spawnSyncMock.mock.calls[1]?.[1]).toEqual(["cron", "enable", "disabled-1"])
  })

  it("fails when enabling a matching disabled job fails", () => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

    spawnSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          jobs: [
            {
              id: "disabled-2",
              name: "zettelclaw-reset",
              enabled: false,
              cron: "0 2 * * *",
              tz: timeZone,
              session: "isolated",
              message: "/reset",
            },
          ],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "enable failed" })

    const result = ensureZettelclawSweepCronJob()
    expect(result.status).toBe("failed")
    expect(result.message).toContain("Could not enable zettelclaw-reset")
  })

  it("fails when creating a new cron job fails", () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ jobs: [] }), stderr: "" })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "add failed" })

    const result = ensureZettelclawSweepCronJob()
    expect(result.status).toBe("failed")
    expect(result.message).toContain("Could not create zettelclaw-reset")
  })
})
