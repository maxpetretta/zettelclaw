import { beforeAll, beforeEach, describe, expect, it } from "bun:test"

import { resetSpawnSyncMock, spawnSyncMock } from "./helpers/child-process-mock"

let scheduleAgentCronJob: typeof import("../openclaw-jobs").scheduleAgentCronJob
let waitForCronSummary: typeof import("../openclaw-jobs").waitForCronSummary
let removeCronJob: typeof import("../openclaw-jobs").removeCronJob
let removeCronJobsByName: typeof import("../openclaw-jobs").removeCronJobsByName

beforeAll(async () => {
  const loaded = await import("../openclaw-jobs")
  scheduleAgentCronJob = loaded.scheduleAgentCronJob
  waitForCronSummary = loaded.waitForCronSummary
  removeCronJob = loaded.removeCronJob
  removeCronJobsByName = loaded.removeCronJobsByName
})

beforeEach(() => {
  resetSpawnSyncMock()
})

describe("scheduleAgentCronJob", () => {
  it("schedules in compatibility mode and returns a job id", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '{"id":"job-123"}',
      stderr: "",
    })

    const scheduled = await scheduleAgentCronJob({
      message: "do work",
      sessionName: "zettelclaw-migrate-subagent",
    })

    expect(scheduled).toEqual({ jobId: "job-123", mode: "compatible" })

    const args = spawnSyncMock.mock.calls[0]?.[1]
    expect(args).toEqual(
      expect.arrayContaining([
        "cron",
        "add",
        "--at",
        "--session",
        "isolated",
        "--name",
        "zettelclaw-migrate-subagent",
        "--message",
        "do work",
        "--no-deliver",
        "--delete-after-run",
        "--timeout-seconds",
        "1800",
        "--json",
      ]),
    )
    const atIndex = args?.indexOf("--at") ?? -1
    expect(atIndex).toBeGreaterThanOrEqual(0)
    const atValue = typeof atIndex === "number" && atIndex >= 0 ? args?.[atIndex + 1] : undefined
    expect(typeof atValue).toBe("string")
    expect(atValue).not.toBe("+0s")
  })

  it("supports optional model/announce/delete-after-run flags", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '{"id":"job-456"}',
      stderr: "",
    })

    const scheduled = await scheduleAgentCronJob({
      message: "do work",
      sessionName: "custom-session",
      model: "claude-sonnet",
      announce: true,
      deleteAfterRun: false,
      timeoutSeconds: 120,
      sessionTarget: "shared",
    })

    expect(scheduled).toEqual({ jobId: "job-456", mode: "compatible" })

    const args = spawnSyncMock.mock.calls[0]?.[1] ?? []
    expect(args).toEqual(
      expect.arrayContaining([
        "--session",
        "shared",
        "--name",
        "custom-session",
        "--timeout-seconds",
        "120",
        "--model",
        "claude-sonnet",
      ]),
    )
    expect(args).not.toContain("--no-deliver")
    expect(args).not.toContain("--delete-after-run")
  })

  it("falls back to legacy mode when compatibility scheduling fails", async () => {
    spawnSyncMock
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "compat failed",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "compat failed",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "compat failed",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: '{"id":"job-legacy"}',
        stderr: "",
      })

    const scheduled = await scheduleAgentCronJob({
      message: "do work",
      sessionName: "zettelclaw-migrate-subagent",
    })

    expect(scheduled).toEqual({ jobId: "job-legacy", mode: "legacy" })
    const firstArgs = spawnSyncMock.mock.calls[0]?.[1] ?? []
    const secondArgs = spawnSyncMock.mock.calls[3]?.[1] ?? []
    const firstAtIndex = firstArgs.indexOf("--at")
    const secondAtIndex = secondArgs.indexOf("--at")
    expect(firstAtIndex).toBeGreaterThanOrEqual(0)
    expect(secondAtIndex).toBeGreaterThanOrEqual(0)
    expect(firstArgs[firstAtIndex + 1]).not.toBe("+0s")
    expect(secondArgs[secondAtIndex + 1]).toBe("+0s")
  })

  it("throws when cron add succeeds without returning a job id", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "{}",
      stderr: "",
    })

    await expect(
      scheduleAgentCronJob({
        message: "do work",
        sessionName: "zettelclaw-migrate-subagent",
      }),
    ).rejects.toThrow("[SCHEDULING_FAILED]")
  })

  it("wraps unexpected command exceptions after retries", async () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error("spawn exploded")
    })

    await expect(
      scheduleAgentCronJob({
        message: "do work",
        sessionName: "zettelclaw-migrate-subagent",
      }),
    ).rejects.toThrow("[COMMAND_FAILED]")
  })
})

describe("waitForCronSummary", () => {
  it("returns summary when a finished entry is ok", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        entries: [
          {
            action: "finished",
            status: "ok",
            summary: "migration complete",
            ts: 10,
          },
        ],
      }),
      stderr: "",
    })

    const summary = await waitForCronSummary("job-123", 500)
    expect(summary).toBe("migration complete")
    const args = spawnSyncMock.mock.calls[0]?.[1] ?? []
    expect(args).toEqual(expect.arrayContaining(["cron", "runs", "--id", "job-123", "--limit", "20"]))
  })

  it("returns summary for delivery-target failures when summary exists", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        entries: [
          {
            action: "finished",
            status: "error",
            error: "cron delivery target is missing",
            summary: "summary still available",
            ts: 20,
          },
        ],
      }),
      stderr: "",
    })

    const summary = await waitForCronSummary("job-456", 500)
    expect(summary).toBe("summary still available")
  })

  it("throws when a finished entry reports an unrecoverable error", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        entries: [
          {
            action: "finished",
            status: "error",
            error: "tool execution failed",
            summary: "",
            ts: 30,
          },
        ],
      }),
      stderr: "",
    })

    await expect(waitForCronSummary("job-789", 500)).rejects.toThrow("[JOB_FAILED]")
  })

  it("emits debug callback messages while polling and finishing", async () => {
    const debugMessages: string[] = []
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        entries: [
          {
            action: "finished",
            status: "ok",
            summary: "done",
            ts: 40,
          },
        ],
      }),
      stderr: "",
    })

    const summary = await waitForCronSummary("job-debug", 500, {
      onDebug: (message) => {
        debugMessages.push(message)
      },
    })
    expect(summary).toBe("done")
    expect(debugMessages.some((message) => message.includes("poll 1"))).toBe(true)
    expect(debugMessages.some((message) => message.includes("finished with status=ok"))).toBe(true)
  })

  it("emits queued/running runtime state from cron list when entries are not yet finished", async () => {
    const debugMessages: string[] = []
    spawnSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          jobs: [
            {
              id: "job-state",
              name: "zettelclaw-migrate-subagent",
              state: {
                runningAtMs: Date.now() - 2_500,
              },
            },
          ],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [
            {
              action: "finished",
              status: "ok",
              summary: "done",
              ts: 50,
            },
          ],
        }),
        stderr: "",
      })

    const summary = await waitForCronSummary("job-state", 1_000, {
      onDebug: (message) => {
        debugMessages.push(message)
      },
      pollIntervalMs: 1,
    })

    expect(summary).toBe("done")
    expect(debugMessages.some((message) => message.includes("runtime: state=running"))).toBe(true)
  })
})

describe("removeCronJob", () => {
  it("does not throw on cleanup errors", () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error("spawn failed")
    })

    expect(() => removeCronJob("job-1")).not.toThrow()
  })
})

describe("removeCronJobsByName", () => {
  it("removes matching jobs by name and reports counts", async () => {
    spawnSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          jobs: [
            { id: "job-1", name: "zettelclaw-migrate-subagent" },
            { id: "job-2", name: "other-job" },
            { id: "job-3", name: "zettelclaw-migrate-synthesis" },
          ],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })

    const result = await removeCronJobsByName(["zettelclaw-migrate-subagent", "zettelclaw-migrate-synthesis"])
    expect(result).toEqual({
      scannedJobs: 3,
      matchedJobs: 2,
      removedJobs: 2,
      failedJobIds: [],
    })
  })

  it("captures remove failures and keeps going", async () => {
    spawnSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          jobs: [{ id: "job-1", name: "zettelclaw-migrate-subagent" }],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "rm failed" })

    const result = await removeCronJobsByName(["zettelclaw-migrate-subagent"])
    expect(result.scannedJobs).toBe(1)
    expect(result.matchedJobs).toBe(1)
    expect(result.removedJobs).toBe(0)
    expect(result.failedJobIds).toEqual(["job-1"])
  })
})
