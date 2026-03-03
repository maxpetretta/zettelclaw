import { asRecord, type JsonRecord } from "./json"

export interface ParseCronJobsResult {
  jobs: JsonRecord[]
  error?: string
}

export interface CronJobSnapshot {
  name: string
  enabled: boolean
  expression: string | undefined
  session: string | undefined
  message: string | undefined
  raw: JsonRecord
}

export function parseCronJobs(raw: string): ParseCronJobsResult {
  try {
    const parsed = asRecord(JSON.parse(raw))
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : []
    return { jobs: jobs.map((entry) => asRecord(entry)) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { jobs: [], error: message }
  }
}

function readText(record: JsonRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }

  return undefined
}

export function isCronJobEnabled(job: JsonRecord): boolean {
  return job.enabled === true || job.enabled === "true"
}

export function readCronJobExpression(job: JsonRecord): string | undefined {
  const direct = readText(job, ["cron", "schedule"])
  if (direct) {
    return direct
  }

  const schedule = asRecord(job.schedule)
  return readText(schedule, ["expr", "cron"])
}

export function readCronJobTimeZone(job: JsonRecord): string | undefined {
  const direct = readText(job, ["tz", "timezone"])
  if (direct) {
    return direct
  }

  const schedule = asRecord(job.schedule)
  return readText(schedule, ["tz", "timezone"])
}

export function readCronJobSession(job: JsonRecord): string | undefined {
  const direct = readText(job, ["session", "sessionKey", "sessionTarget"])
  if (direct) {
    return direct
  }

  const payload = asRecord(job.payload)
  return readText(payload, ["session", "sessionKey", "sessionTarget"])
}

export function readCronJobMessage(job: JsonRecord): string | undefined {
  const direct = readText(job, ["message"])
  if (direct) {
    return direct
  }

  const payload = asRecord(job.payload)
  return readText(payload, ["message"])
}

export function readCronJobId(job: JsonRecord): string | undefined {
  const id = job.id
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : undefined
}

export function toCronJobSnapshot(job: JsonRecord): CronJobSnapshot | undefined {
  const name = readText(job, ["name"])
  if (!name) {
    return undefined
  }

  return {
    name,
    enabled: isCronJobEnabled(job),
    expression: readCronJobExpression(job),
    session: readCronJobSession(job),
    message: readCronJobMessage(job),
    raw: job,
  }
}

export function toCronJobSnapshots(jobs: readonly JsonRecord[]): CronJobSnapshot[] {
  const snapshots: CronJobSnapshot[] = []
  for (const job of jobs) {
    const snapshot = toCronJobSnapshot(job)
    if (snapshot) {
      snapshots.push(snapshot)
    }
  }

  return snapshots
}
