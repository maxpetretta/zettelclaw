import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { parseJson, runOpenClawCommand } from "../openclaw-command"
import {
  parseCronJobs,
  readCronJobExpression,
  readCronJobId,
  readCronJobMessage,
  readCronJobSession,
  readCronJobTimeZone,
  toCronJobSnapshot,
  toCronJobSnapshots,
} from "../openclaw-cron"
import { removeCronJob, scheduleAgentCronJob, waitForCronSummary } from "../openclaw-jobs"
import { withEnv, withTempDir, writeExecutable } from "./test-helpers"

describe("openclaw command helpers", () => {
  test("runs the openclaw command and parses JSON payloads", async () => {
    await withTempDir("zettelclaw-openclaw-cli-", async (dir) => {
      const binDir = join(dir, "bin")
      await writeExecutable(
        join(binDir, "openclaw"),
        `#!/bin/sh
printf '{"ok":true,"args":"%s"}' "$*"
`,
      )

      await withEnv({ PATH: binDir }, () => {
        const result = runOpenClawCommand(["status"])
        expect(result.ok).toBe(true)
        expect(parseJson<{ args: string; ok: boolean }>(result.stdout)).toEqual({
          value: { ok: true, args: "status" },
        })
      })
    })
  })

  test("parses cron job payloads into snapshots", () => {
    const parsed = parseCronJobs(
      JSON.stringify({
        jobs: [
          {
            name: "Morning review",
            enabled: "true",
            schedule: { expr: "0 9 * * *", timezone: "America/Detroit" },
            payload: { sessionKey: "daily", message: "Review inbox" },
          },
          {
            id: "missing-name",
          },
        ],
      }),
    )

    expect(parsed.error).toBeUndefined()
    expect(toCronJobSnapshots(parsed.jobs)).toEqual([
      expect.objectContaining({
        name: "Morning review",
        enabled: true,
        expression: "0 9 * * *",
        session: "daily",
        message: "Review inbox",
      }),
    ])
  })

  test("reports openclaw command failures and JSON parse errors", async () => {
    await withTempDir("zettelclaw-openclaw-command-errors-", async (dir) => {
      const binDir = join(dir, "bin")
      await writeExecutable(
        join(binDir, "openclaw"),
        `#!/bin/sh
if [ "$1" = "stderr" ]; then
  echo "bad stderr" >&2
  exit 2
fi
if [ "$1" = "stdout" ]; then
  echo "bad stdout"
  exit 3
fi
exit 1
`,
      )

      await withEnv({ PATH: binDir }, () => {
        expect(runOpenClawCommand(["stderr"])).toMatchObject({
          ok: false,
          status: 2,
          message: "bad stderr",
        })
        expect(runOpenClawCommand(["stdout"])).toMatchObject({
          ok: false,
          status: 3,
          message: "bad stdout",
        })
      })

      await withEnv({ PATH: join(dir, "empty-bin") }, () => {
        expect(runOpenClawCommand(["missing"])).toMatchObject({
          ok: false,
          errorCode: "ENOENT",
        })
      })
    })

    expect(parseJson("{ nope")).toMatchObject({
      error: expect.stringContaining("Expected"),
    })
  })

  test("reads direct cron job fields and skips unnamed jobs", () => {
    expect(parseCronJobs("not json")).toMatchObject({
      jobs: [],
      error: expect.any(String),
    })

    const directJob = {
      id: " cron-1 ",
      name: "  Review  ",
      enabled: true,
      cron: "*/5 * * * *",
      tz: "UTC",
      session: "main",
      message: "Check inbox",
    }

    expect(readCronJobExpression(directJob)).toBe("*/5 * * * *")
    expect(readCronJobTimeZone(directJob)).toBe("UTC")
    expect(readCronJobSession(directJob)).toBe("main")
    expect(readCronJobMessage(directJob)).toBe("Check inbox")
    expect(readCronJobId(directJob)).toBe("cron-1")
    expect(toCronJobSnapshot(directJob)).toEqual(
      expect.objectContaining({
        name: "Review",
        enabled: true,
      }),
    )
    expect(toCronJobSnapshot({ id: "missing-name" })).toBeUndefined()
  })

  test("schedules and observes openclaw cron jobs through the CLI", async () => {
    await withTempDir("zettelclaw-openclaw-jobs-", async (dir) => {
      const binDir = join(dir, "bin")
      await writeExecutable(
        join(binDir, "openclaw"),
        `#!/bin/sh
if [ "$1" = "cron" ] && [ "$2" = "add" ]; then
  echo '{"id":"job-123"}'
  exit 0
fi
if [ "$1" = "cron" ] && [ "$2" = "runs" ]; then
  echo '{"entries":[{"action":"finished","status":"ok","summary":"all good","ts":1}]}'
  exit 0
fi
if [ "$1" = "cron" ] && [ "$2" = "rm" ]; then
  exit 0
fi
exit 1
`,
      )

      await withEnv({ PATH: binDir }, async () => {
        await expect(
          scheduleAgentCronJob({
            message: "Run agent",
            sessionName: "daily",
          }),
        ).resolves.toEqual({
          jobId: "job-123",
          mode: "legacy",
        })

        await expect(waitForCronSummary("job-123", 100)).resolves.toBe("all good")
        expect(() => removeCronJob("job-123")).not.toThrow()
      })
    })
  })

  test("falls back to compatible cron scheduling and surfaces scheduling failures", async () => {
    await withTempDir("zettelclaw-openclaw-compatible-", async (dir) => {
      const binDir = join(dir, "bin")
      await writeExecutable(
        join(binDir, "openclaw"),
        `#!/bin/sh
if [ "$1" = "cron" ] && [ "$2" = "add" ]; then
  if [ "$4" = "+0s" ]; then
    echo "legacy failed" >&2
    exit 1
  fi
  echo '{"id":"job-compatible"}'
  exit 0
fi
exit 1
`,
      )

      await withEnv({ PATH: binDir }, async () => {
        await expect(
          scheduleAgentCronJob({
            announce: true,
            deleteAfterRun: false,
            message: "Run agent",
            model: "gpt-5",
            sessionName: "daily",
            sessionTarget: "main",
          }),
        ).resolves.toEqual({
          jobId: "job-compatible",
          mode: "compatible",
        })
      })
    })

    await withTempDir("zettelclaw-openclaw-bad-add-", async (dir) => {
      const binDir = join(dir, "bin")
      await writeExecutable(
        join(binDir, "openclaw"),
        `#!/bin/sh
if [ "$1" = "cron" ] && [ "$2" = "add" ]; then
  echo '{}'
  exit 0
fi
exit 1
`,
      )

      await withEnv({ PATH: binDir }, async () => {
        await expect(
          scheduleAgentCronJob({
            message: "Run agent",
            sessionName: "daily",
          }),
        ).rejects.toMatchObject({
          code: "SCHEDULING_FAILED",
        })
      })
    })
  })

  test("handles cron delivery summaries, job failures, and cleanup failures", async () => {
    await withTempDir("zettelclaw-openclaw-delivery-", async (dir) => {
      const binDir = join(dir, "bin")
      await writeExecutable(
        join(binDir, "openclaw"),
        `#!/bin/sh
if [ "$1" = "cron" ] && [ "$2" = "runs" ]; then
  echo '{"entries":[{"action":"finished","status":"error","summary":"delivered summary","error":"cron delivery target is missing","ts":1}]}'
  exit 0
fi
if [ "$1" = "cron" ] && [ "$2" = "rm" ]; then
  exit 1
fi
exit 1
`,
      )

      await withEnv({ PATH: binDir }, async () => {
        await expect(waitForCronSummary("job-delivery", 100)).resolves.toBe("delivered summary")
        expect(() => removeCronJob("job-delivery")).not.toThrow()
      })
    })

    await withTempDir("zettelclaw-openclaw-job-fail-", async (dir) => {
      const binDir = join(dir, "bin")
      await writeExecutable(
        join(binDir, "openclaw"),
        `#!/bin/sh
if [ "$1" = "cron" ] && [ "$2" = "runs" ]; then
  echo '{"entries":[{"action":"finished","status":"error","summary":"bad summary","error":"hard failure","ts":1}]}'
  exit 0
fi
exit 1
`,
      )

      await withEnv({ PATH: binDir }, async () => {
        await expect(waitForCronSummary("job-failure", 100)).rejects.toMatchObject({
          code: "JOB_FAILED",
          details: "hard failure",
        })
      })
    })

    await withEnv({ PATH: "/definitely/missing" }, () => {
      expect(() => removeCronJob("job-missing-cli")).not.toThrow()
    })
  })
})
