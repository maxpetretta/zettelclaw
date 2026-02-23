import { parseJson, runOpenClawCommand } from "./openclaw-command"

interface OpenClawCommandOptions {
  timeoutMs?: number
  allowFailure?: boolean
}

interface OpenClawCommandResult {
  status: number
  stdout: string
  stderr: string
}

const CRON_RUNS_FETCH_LIMIT = "20"
const CRON_RUNS_POLL_INTERVAL_MS = 3_000
const CRON_RUNS_TIMEOUT_MS = 30_000

interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

interface CronAddResponse {
  id: string
}

interface CronRunsResponse {
  entries?: CronRunEntry[]
}

interface CronListResponse {
  jobs?: CronListJobEntry[]
}

interface CronListJobEntry {
  id?: string
  name?: string
}

interface CronRunEntry {
  action?: string
  status?: string
  summary?: string
  error?: string
  ts?: number
}

type OpenClawErrorCode =
  | "CLI_NOT_FOUND"
  | "COMMAND_FAILED"
  | "INVALID_JSON"
  | "SCHEDULING_FAILED"
  | "JOB_FAILED"
  | "TIMEOUT"

export class OpenClawJobError extends Error {
  code: OpenClawErrorCode
  details?: string

  constructor(code: OpenClawErrorCode, message: string, details?: string) {
    super(`[${code}] ${message}`)
    this.name = "OpenClawJobError"
    this.code = code
    if (details !== undefined) {
      this.details = details
    }
  }
}

export interface ScheduleAgentCronJobParams {
  message: string
  model?: string
  sessionName: string
  timeoutSeconds?: number
  sessionTarget?: string
  deleteAfterRun?: boolean
  announce?: boolean
  onDebug?: (message: string) => void
}

export interface ScheduledAgentCronJob {
  jobId: string
  mode: "legacy" | "compatible"
}

export interface RemoveCronJobsByNameResult {
  scannedJobs: number
  matchedJobs: number
  removedJobs: number
  failedJobIds: string[]
}

export interface WaitForCronSummaryOptions {
  onDebug?: (message: string) => void
  pollIntervalMs?: number
}

function runOpenClaw(args: string[], options: OpenClawCommandOptions = {}): OpenClawCommandResult {
  const commandOptions: { timeoutMs?: number } = {}
  if (options.timeoutMs !== undefined) {
    commandOptions.timeoutMs = options.timeoutMs
  }

  const result = runOpenClawCommand(args, commandOptions)

  if (!result.ok && result.errorCode === "ENOENT") {
    throw new OpenClawJobError("CLI_NOT_FOUND", "openclaw CLI was not found on PATH.")
  }

  if (!result.ok && options.allowFailure !== true) {
    throw new OpenClawJobError("COMMAND_FAILED", `openclaw ${args.join(" ")} failed.`, result.message)
  }

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

export async function scheduleAgentCronJob(params: ScheduleAgentCronJobParams): Promise<ScheduledAgentCronJob> {
  const timeoutSeconds = params.timeoutSeconds ?? 1800
  const sessionName = params.sessionName
  const sessionTarget = params.sessionTarget ?? "isolated"
  const shouldDeleteAfterRun = params.deleteAfterRun !== false
  const shouldAnnounce = params.announce === true

  const buildCronAddArgs = (atValue: string): string[] => {
    const args = [
      "cron",
      "add",
      "--at",
      atValue,
      "--session",
      sessionTarget,
      "--name",
      sessionName,
      "--message",
      params.message,
    ]

    if (!shouldAnnounce) {
      args.push("--no-deliver")
    }
    if (shouldDeleteAfterRun) {
      args.push("--delete-after-run")
    }

    args.push("--timeout-seconds", String(timeoutSeconds), "--json")

    if (params.model) {
      args.push("--model", params.model)
    }

    return args
  }

  const compatibleResult = await runOpenClawWithRetries(buildCronAddArgs(new Date().toISOString()), {
    allowFailure: true,
    timeoutMs: 60_000,
    retries: { attempts: 3, baseDelayMs: 900, maxDelayMs: 6_000 },
  })

  if (compatibleResult.status === 0) {
    const jobId = parseCronAddJobId(compatibleResult.stdout)
    params.onDebug?.(`Scheduled cron job ${jobId} in compatibility mode (absolute timestamp).`)
    return {
      jobId,
      mode: "compatible",
    }
  }

  params.onDebug?.(`Compatibility cron scheduling failed; retrying with legacy +0s mode (${compatibleResult.status}).`)

  const legacyResult = await runOpenClawWithRetries(buildCronAddArgs("+0s"), {
    allowFailure: true,
    timeoutMs: 60_000,
    retries: { attempts: 3, baseDelayMs: 900, maxDelayMs: 6_000 },
  })

  if (legacyResult.status !== 0) {
    const compatibleError =
      compatibleResult.stderr.trim() || compatibleResult.stdout.trim() || String(compatibleResult.status)
    const legacyError = legacyResult.stderr.trim() || legacyResult.stdout.trim() || String(legacyResult.status)
    throw new OpenClawJobError(
      "SCHEDULING_FAILED",
      "Could not schedule agent cron job (compatibility + legacy attempts failed).",
      `${compatibleError}; ${legacyError}`,
    )
  }

  const jobId = parseCronAddJobId(legacyResult.stdout)
  params.onDebug?.(`Scheduled cron job ${jobId} in legacy mode (+0s).`)
  return {
    jobId,
    mode: "legacy",
  }
}

export async function removeCronJobsByName(
  names: readonly string[],
  options: { onDebug?: (message: string) => void } = {},
): Promise<RemoveCronJobsByNameResult> {
  const normalizedNames = new Set(names.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0))

  if (normalizedNames.size === 0) {
    return {
      scannedJobs: 0,
      matchedJobs: 0,
      removedJobs: 0,
      failedJobIds: [],
    }
  }

  const listed = await runOpenClawWithRetries(["cron", "list", "--json"], {
    allowFailure: true,
    timeoutMs: 30_000,
    retries: { attempts: 2, baseDelayMs: 500, maxDelayMs: 2_000 },
  })

  if (listed.status !== 0) {
    const detail = listed.stderr.trim() || listed.stdout.trim() || String(listed.status)
    throw new OpenClawJobError("COMMAND_FAILED", "Could not list cron jobs.", detail)
  }

  const parsed = parseJson<CronListResponse>(listed.stdout)
  if (!parsed.value) {
    throw new OpenClawJobError("INVALID_JSON", "Could not parse cron jobs JSON.", parsed.error)
  }

  const jobs = Array.isArray(parsed.value.jobs) ? parsed.value.jobs : []
  let matchedJobs = 0
  let removedJobs = 0
  const failedJobIds: string[] = []

  for (const job of jobs) {
    const name = typeof job.name === "string" ? job.name.trim() : ""
    const id = typeof job.id === "string" ? job.id.trim() : ""

    if (name.length === 0 || id.length === 0) {
      continue
    }
    if (!normalizedNames.has(name.toLowerCase())) {
      continue
    }

    matchedJobs += 1
    let removed: OpenClawCommandResult
    try {
      removed = runOpenClaw(["cron", "rm", id], { allowFailure: true, timeoutMs: 15_000 })
    } catch (error) {
      failedJobIds.push(id)
      const detail = error instanceof Error ? error.message : String(error)
      options.onDebug?.(`Failed to remove stale cron job ${id} (${name}): ${detail}`)
      continue
    }
    if (removed.status === 0) {
      removedJobs += 1
      options.onDebug?.(`Removed stale cron job ${id} (${name}).`)
      continue
    }

    failedJobIds.push(id)
    const detail = removed.stderr.trim() || removed.stdout.trim() || `exit ${removed.status}`
    options.onDebug?.(`Failed to remove stale cron job ${id} (${name}): ${detail}`)
  }

  return {
    scannedJobs: jobs.length,
    matchedJobs,
    removedJobs,
    failedJobIds,
  }
}

export async function waitForCronSummary(
  jobId: string,
  timeoutMs = 1_900_000,
  options: WaitForCronSummaryOptions = {},
): Promise<string> {
  const startedAt = Date.now()
  let transientFailures = 0
  let pollCount = 0
  const pollIntervalMs =
    typeof options.pollIntervalMs === "number" && Number.isFinite(options.pollIntervalMs) && options.pollIntervalMs > 0
      ? Math.floor(options.pollIntervalMs)
      : CRON_RUNS_POLL_INTERVAL_MS

  while (Date.now() - startedAt < timeoutMs) {
    pollCount += 1
    let result: OpenClawCommandResult
    try {
      result = runOpenClaw(["cron", "runs", "--id", jobId, "--limit", CRON_RUNS_FETCH_LIMIT], {
        allowFailure: true,
        timeoutMs: CRON_RUNS_TIMEOUT_MS,
      })
    } catch (error) {
      const wrapped = toOpenClawJobError(error)
      if (wrapped.code === "CLI_NOT_FOUND") {
        throw wrapped
      }

      transientFailures += 1
      options.onDebug?.(
        `cron ${jobId} poll ${pollCount}: command threw ${wrapped.code} (${wrapped.details ?? wrapped.message})`,
      )
      if (transientFailures >= 5) {
        throw new OpenClawJobError(
          "COMMAND_FAILED",
          `openclaw cron runs failed repeatedly while waiting for job ${jobId}.`,
          wrapped.details ?? wrapped.message,
        )
      }

      await sleep(backoffDelayMs(transientFailures, 1_000, 8_000))
      continue
    }

    if (result.status !== 0) {
      transientFailures += 1
      options.onDebug?.(
        `cron ${jobId} poll ${pollCount}: command failed (${result.status}) ${
          result.stderr.trim() || result.stdout.trim() || "no detail"
        }`,
      )
      if (transientFailures >= 5) {
        const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.status}`
        throw new OpenClawJobError(
          "COMMAND_FAILED",
          `openclaw cron runs failed repeatedly while waiting for job ${jobId}.`,
          detail,
        )
      }

      await sleep(backoffDelayMs(transientFailures, 1_000, 8_000))
      continue
    }

    const parsed = parseJson<CronRunsResponse>(result.stdout)
    if (!parsed.value) {
      transientFailures += 1
      options.onDebug?.(`cron ${jobId} poll ${pollCount}: invalid JSON (${parsed.error ?? "unknown parse failure"})`)
      if (transientFailures >= 5) {
        throw new OpenClawJobError(
          "INVALID_JSON",
          `openclaw cron runs returned invalid JSON repeatedly for job ${jobId}.`,
          parsed.error,
        )
      }

      await sleep(backoffDelayMs(transientFailures, 1_000, 8_000))
      continue
    }

    transientFailures = 0
    const entries = Array.isArray(parsed.value.entries) ? parsed.value.entries : []
    const finishedCount = entries.filter((entry) => entry.action === "finished").length
    if (pollCount === 1 || pollCount % 5 === 0 || finishedCount > 0) {
      options.onDebug?.(`cron ${jobId} poll ${pollCount}: entries=${entries.length}, finishedEntries=${finishedCount}`)
    }
    const finishedEntry = entries
      .filter((entry) => entry.action === "finished")
      .sort((left, right) => (right.ts ?? 0) - (left.ts ?? 0))[0]

    if (finishedEntry) {
      options.onDebug?.(
        `cron ${jobId} finished with status=${finishedEntry.status ?? "unknown"} after ${Date.now() - startedAt}ms`,
      )
      if (finishedEntry.status && finishedEntry.status !== "ok") {
        const errorText =
          typeof finishedEntry.error === "string" && finishedEntry.error.trim().length > 0
            ? finishedEntry.error.trim()
            : ""
        const summaryText =
          typeof finishedEntry.summary === "string" && finishedEntry.summary.trim().length > 0
            ? finishedEntry.summary
            : ""
        const normalizedError = errorText.toLowerCase()
        const isDeliveryFailure =
          normalizedError.includes("cron delivery target is missing") ||
          normalizedError.includes("cron announce delivery failed")

        if (isDeliveryFailure && summaryText.length > 0) {
          return summaryText
        }

        const detail =
          (errorText.length > 0 ? errorText : undefined) ??
          (summaryText.length > 0 ? summaryText : undefined) ??
          "no summary"
        throw new OpenClawJobError(
          "JOB_FAILED",
          `Cron job ${jobId} finished with status '${finishedEntry.status}'.`,
          detail,
        )
      }

      return finishedEntry.summary ?? ""
    }

    await sleep(pollIntervalMs)
  }

  options.onDebug?.(`cron ${jobId} timed out after ${Date.now() - startedAt}ms`)
  throw new OpenClawJobError("TIMEOUT", `Timed out waiting for cron job ${jobId}.`)
}

export function removeCronJob(jobId: string): void {
  try {
    runOpenClaw(["cron", "rm", jobId], { allowFailure: true, timeoutMs: 15_000 })
  } catch {
    // Best-effort cleanup.
  }
}

function parseCronAddJobId(stdout: string): string {
  const parsed = parseJson<CronAddResponse>(stdout)
  const id = typeof parsed.value?.id === "string" ? parsed.value.id : ""
  if (id.length === 0) {
    throw new OpenClawJobError("SCHEDULING_FAILED", "openclaw cron add did not return a job id.", stdout)
  }

  return id
}

async function runOpenClawWithRetries(
  args: string[],
  options: OpenClawCommandOptions & { retries?: RetryOptions },
): Promise<OpenClawCommandResult> {
  const attempts = options.retries?.attempts ?? 1
  const baseDelayMs = options.retries?.baseDelayMs ?? 700
  const maxDelayMs = options.retries?.maxDelayMs ?? 5_000
  const safeAttempts = attempts < 1 ? 1 : attempts

  let lastResult: OpenClawCommandResult | null = null
  let lastError: OpenClawJobError | null = null

  for (let attempt = 1; attempt <= safeAttempts; attempt += 1) {
    try {
      const commandOptions: OpenClawCommandOptions = {}
      if (options.allowFailure !== undefined) {
        commandOptions.allowFailure = options.allowFailure
      }
      if (options.timeoutMs !== undefined) {
        commandOptions.timeoutMs = options.timeoutMs
      }

      const result = runOpenClaw(args, commandOptions)

      if (result.status === 0) {
        return result
      }

      lastResult = result
    } catch (error) {
      const wrapped = toOpenClawJobError(error)
      if (wrapped.code === "CLI_NOT_FOUND") {
        throw wrapped
      }

      lastError = wrapped
    }

    if (attempt < safeAttempts) {
      await sleep(backoffDelayMs(attempt, baseDelayMs, maxDelayMs))
    }
  }

  if (lastResult) {
    return lastResult
  }

  const detail = lastError?.details ?? lastError?.message
  throw new OpenClawJobError(
    "COMMAND_FAILED",
    `openclaw ${args.join(" ")} failed after ${safeAttempts} attempts.`,
    detail,
  )
}

function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const scale = 2 ** (attempt - 1)
  const next = baseDelayMs * scale
  return next > maxDelayMs ? maxDelayMs : next
}

function toOpenClawJobError(value: unknown): OpenClawJobError {
  if (value instanceof OpenClawJobError) {
    return value
  }

  const message = value instanceof Error ? value.message : String(value)
  return new OpenClawJobError("COMMAND_FAILED", "Unknown OpenClaw error.", message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
