import { beforeAll, beforeEach, describe, expect, it } from "bun:test"

import { resetSpawnSyncMock, spawnSyncMock } from "./helpers/child-process-mock"

let scheduleAgentCronJob: typeof import("../openclaw-jobs").scheduleAgentCronJob
let waitForCronSummary: typeof import("../openclaw-jobs").waitForCronSummary
let removeCronJob: typeof import("../openclaw-jobs").removeCronJob

beforeAll(async () => {
  const loaded = await import("../openclaw-jobs")
  scheduleAgentCronJob = loaded.scheduleAgentCronJob
  waitForCronSummary = loaded.waitForCronSummary
  removeCronJob = loaded.removeCronJob
})

beforeEach(() => {
  resetSpawnSyncMock()
})

describe("scheduleAgentCronJob", () => {
  it("schedules in legacy mode and returns a job id", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '{"id":"job-123"}',
      stderr: "",
    })

    const scheduled = await scheduleAgentCronJob({
      message: "do work",
      sessionName: "zettelclaw-migrate-subagent",
    })

    expect(scheduled).toEqual({ jobId: "job-123", mode: "legacy" })

    const args = spawnSyncMock.mock.calls[0]?.[1]
    expect(args).toEqual(
      expect.arrayContaining([
        "cron",
        "add",
        "--at",
        "+0s",
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

    expect(scheduled).toEqual({ jobId: "job-456", mode: "legacy" })

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
})

describe("removeCronJob", () => {
  it("does not throw on cleanup errors", () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error("spawn failed")
    })

    expect(() => removeCronJob("job-1")).not.toThrow()
  })
})
