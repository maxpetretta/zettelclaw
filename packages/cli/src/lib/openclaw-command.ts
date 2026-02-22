import { spawnSync } from "node:child_process"

export interface OpenClawCommandOptions {
  timeoutMs?: number
  allowFailure?: boolean
}

export interface OpenClawCommandResult {
  ok: boolean
  status: number
  stdout: string
  stderr: string
  message?: string
  errorCode?: string
}

function formatFailureMessage(args: string[], status: number, stderr: string, stdout: string): string {
  const trimmedStderr = stderr.trim()
  if (trimmedStderr.length > 0) {
    return trimmedStderr
  }

  const trimmedStdout = stdout.trim()
  if (trimmedStdout.length > 0) {
    return trimmedStdout
  }

  return `openclaw ${args.join(" ")} exited with code ${status}`
}

export function runOpenClawCommand(args: string[], options: OpenClawCommandOptions = {}): OpenClawCommandResult {
  const result = spawnSync("openclaw", args, {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 30_000,
  })

  const stdout = result.stdout ?? ""
  const stderr = result.stderr ?? ""
  const status = result.status ?? 1

  if (result.error) {
    const maybeCode = "code" in result.error ? result.error.code : undefined
    const output: OpenClawCommandResult = {
      ok: false,
      status,
      stdout,
      stderr,
      message: result.error.message,
    }
    if (typeof maybeCode === "string") {
      output.errorCode = maybeCode
    }

    return output
  }

  if (status !== 0) {
    return {
      ok: false,
      status,
      stdout,
      stderr,
      message: formatFailureMessage(args, status, stderr, stdout),
    }
  }

  return {
    ok: true,
    status,
    stdout,
    stderr,
  }
}

export interface JsonParseResult<T> {
  value?: T
  error?: string
}

export function parseJson<T>(raw: string): JsonParseResult<T> {
  try {
    return { value: JSON.parse(raw) as T }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: message }
  }
}
