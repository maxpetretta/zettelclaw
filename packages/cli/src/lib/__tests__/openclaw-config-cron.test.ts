import { describe, expect, it } from "bun:test"

import {
  parseOpenClawConfig,
  readHookEnabled,
  readOpenClawExtraPaths,
  readOpenClawExtraPathsByScope,
} from "../openclaw-config"
import {
  parseCronJobs,
  readCronJobExpression,
  readCronJobMessage,
  readCronJobSession,
  readCronJobTimeZone,
  toCronJobSnapshots,
} from "../openclaw-cron"

describe("openclaw config parsing", () => {
  it("parses nested extraPaths from both global and defaults scopes", () => {
    const config = parseOpenClawConfig(
      JSON.stringify({
        memorySearch: { extraPaths: ["/global-a", "/global-b"] },
        agents: {
          defaults: {
            memorySearch: {
              extraPaths: ["/defaults-a"],
            },
          },
        },
      }),
    )

    expect(config).toBeDefined()
    expect(readOpenClawExtraPathsByScope(config ?? {})).toEqual({
      global: ["/global-a", "/global-b"],
      defaults: ["/defaults-a"],
    })
    expect(readOpenClawExtraPaths(config ?? {})).toEqual(["/global-a", "/global-b", "/defaults-a"])
  })

  it("handles invalid JSON", () => {
    expect(parseOpenClawConfig("{invalid")).toBeUndefined()
  })

  it("normalizes hook enabled flags from booleans and objects", () => {
    expect(readHookEnabled(true)).toBe(true)
    expect(readHookEnabled(false)).toBe(false)
    expect(readHookEnabled({ enabled: true })).toBe(true)
    expect(readHookEnabled({ enabled: false })).toBe(false)
    expect(readHookEnabled({ enabled: "nope" })).toBeUndefined()
  })
})

describe("cron job parsing", () => {
  it("reads cron fields from direct and nested schedule/payload shapes", () => {
    const { jobs, error } = parseCronJobs(
      JSON.stringify({
        jobs: [
          {
            id: "job-1",
            name: "zettelclaw-reset",
            enabled: "true",
            schedule: { expr: "0 2 * * *", tz: "UTC" },
            payload: { sessionTarget: "isolated", message: "/reset" },
          },
        ],
      }),
    )

    expect(error).toBeUndefined()
    expect(jobs).toHaveLength(1)

    const [job] = jobs
    expect(job).toBeDefined()

    expect(readCronJobExpression(job ?? {})).toBe("0 2 * * *")
    expect(readCronJobTimeZone(job ?? {})).toBe("UTC")
    expect(readCronJobSession(job ?? {})).toBe("isolated")
    expect(readCronJobMessage(job ?? {})).toBe("/reset")

    const snapshots = toCronJobSnapshots(jobs)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toEqual(
      expect.objectContaining({
        name: "zettelclaw-reset",
        enabled: true,
        expression: "0 2 * * *",
        session: "isolated",
        message: "/reset",
      }),
    )
  })

  it("returns a parse error when JSON is malformed", () => {
    const result = parseCronJobs("not json")
    expect(result.jobs).toEqual([])
    expect(typeof result.error).toBe("string")
  })
})
