import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { contentToText } from "./content"
import { asRecord } from "./json"

const SYSTEM_PROMPT = `You are a knowledge extraction agent. Given a conversation transcript, produce a structured journal entry and optionally extract atomic notes.

Your output has two parts:

## 1. Journal Entry (ALWAYS required)
Summarize the session into these sections. Omit a section if nothing fits it. Use bullet points. Use [[wikilinks]] for concepts/projects/people.
- **Done**: What was accomplished
- **Decisions**: Key decisions made and their reasoning
- **Open**: Unresolved questions, blockers, next steps
- **Notes**: Observations, ideas, things to remember

## 2. Atomic Notes (ONLY when warranted)
Extract standalone notes ONLY for genuinely reusable concepts or insights — things that would be valuable outside the context of this conversation. Most sessions produce zero atomic notes. This is expected.

Rules for atomic notes:
- Each captures ONE idea. The title IS the idea in Title Case.
- Skip anything that's just "we did X" — that belongs in the journal
- Skip troubleshooting steps, routine work, and project-specific progress
- Only extract if the insight is reusable and stands alone
- Include [[wikilinks]] to related concepts
- Tags are always pluralized ("projects" not "project")

Respond with JSON only:
{
  "done": ["- bullet point with [[wikilinks]]"],
  "decisions": ["- bullet point"],
  "open": ["- bullet point"],
  "journalNotes": ["- bullet point"],
  "notes": [
    {
      "title": "Note Title In Title Case",
      "type": "note",
      "tags": ["tag1", "tag2"],
      "summary": "One-line summary",
      "body": "Full note content with [[wikilinks]].\\n\\nCan be multiple paragraphs.",
      "source": "conversation"
    }
  ]
}`

export interface ExtractedNote {
  title: string
  type: string
  tags: string[]
  summary: string
  body: string
  source: string
}

export interface SessionSummary {
  done: string[]
  decisions: string[]
  open: string[]
  journalNotes: string[]
  notes: ExtractedNote[]
}

export interface ExtractionResult {
  success: boolean
  summary: SessionSummary
  message?: string
}

interface ExtractOptions {
  cfg?: unknown
  model?: string | undefined
  logger?: (message: string) => void
}

function parseNoteArray(value: unknown): ExtractedNote[] {
  if (!Array.isArray(value)) {
    return []
  }

  const notes: ExtractedNote[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue
    }

    const record = entry as Record<string, unknown>
    const title = typeof record.title === "string" ? record.title.trim() : ""
    if (!title) {
      continue
    }

    const tags = Array.isArray(record.tags)
      ? record.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
      : []

    notes.push({
      title,
      type: typeof record.type === "string" && record.type.trim().length > 0 ? record.type.trim() : "note",
      tags,
      summary: typeof record.summary === "string" && record.summary.trim().length > 0 ? record.summary.trim() : title,
      body: typeof record.body === "string" && record.body.trim().length > 0 ? record.body.trim() : title,
      source:
        typeof record.source === "string" && record.source.trim().length > 0 ? record.source.trim() : "conversation",
    })
  }

  return notes
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim())
}

function parseSummaryOutput(rawOutput: string): SessionSummary | null {
  const trimmed = rawOutput.trim()
  if (!trimmed) {
    return null
  }

  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()

  const parseCandidates = [withoutFence]
  const objStart = withoutFence.indexOf("{")
  const objEnd = withoutFence.lastIndexOf("}")
  if (objStart >= 0 && objEnd > objStart) {
    parseCandidates.push(withoutFence.slice(objStart, objEnd + 1))
  }

  for (const candidate of parseCandidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>
        return {
          done: parseStringArray(record.done),
          decisions: parseStringArray(record.decisions),
          open: parseStringArray(record.open),
          journalNotes: parseStringArray(record.journalNotes),
          notes: parseNoteArray(record.notes),
        }
      }
      if (Array.isArray(parsed)) {
        return {
          done: [],
          decisions: [],
          open: [],
          journalNotes: [],
          notes: parseNoteArray(parsed),
        }
      }
    } catch {
      // Keep trying candidate representations.
    }
  }

  return null
}

function readModelFromConfig(cfg: unknown): string | null {
  const cfgRecord = asRecord(cfg)

  const directModel = cfgRecord.model
  if (typeof directModel === "string" && directModel.trim().length > 0) {
    return directModel.trim()
  }

  const llmConfig = asRecord(cfgRecord.llm)
  const llmModel = llmConfig.model
  if (typeof llmModel === "string" && llmModel.trim().length > 0) {
    return llmModel.trim()
  }

  return null
}

function parseCliOutput(stdout: string): string {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return ""
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return JSON.stringify(parsed)
    }

    const record = asRecord(parsed)
    for (const key of ["output", "content", "result", "text"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim()
      }
    }
  } catch {
    return trimmed
  }

  return trimmed
}

async function readGatewayPort(cfg: unknown): Promise<number> {
  const cfgRecord = asRecord(cfg)
  const gateway = asRecord(cfgRecord.gateway)

  if (typeof gateway.port === "number" && Number.isFinite(gateway.port)) {
    return gateway.port
  }

  if (typeof cfgRecord.gatewayPort === "number" && Number.isFinite(cfgRecord.gatewayPort)) {
    return cfgRecord.gatewayPort
  }

  try {
    const gatewayConfigPath = join(homedir(), ".openclaw", "gateway.json")
    const raw = await readFile(gatewayConfigPath, "utf8")
    const parsed = asRecord(JSON.parse(raw))

    if (typeof parsed.port === "number" && Number.isFinite(parsed.port)) {
      return parsed.port
    }

    const http = asRecord(parsed.http)
    if (typeof http.port === "number" && Number.isFinite(http.port)) {
      return http.port
    }
  } catch {
    // Fall through to default.
  }

  return 3456
}

const EMPTY_SUMMARY: SessionSummary = { done: [], decisions: [], open: [], journalNotes: [], notes: [] }

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  error?: string
}

async function runCommandWithInput(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] }) as ReturnType<typeof spawn> & {
      stdin: NodeJS.WritableStream
      stdout: NodeJS.ReadableStream
      stderr: NodeJS.ReadableStream
      on(event: "error", listener: (error: Error) => void): void
      on(event: "close", listener: (status: number | null) => void): void
    }
    let stdout = ""
    let stderr = ""
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })

    child.on("error", (error: Error) => {
      clearTimeout(timer)
      resolve({ status: null, stdout, stderr, timedOut, error: error.message })
    })

    child.on("close", (status: number | null) => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr, timedOut })
    })

    child.stdin.write(input)
    child.stdin.end()
  })
}

async function runOpenClawCliSummary(
  conversation: string,
  model: string | null,
  logger: (message: string) => void,
): Promise<SessionSummary | null> {
  const args = ["llm-task", "--system", SYSTEM_PROMPT, "--json"]
  if (model) {
    args.push("--model", model)
  }

  const result = await runCommandWithInput("openclaw", args, conversation, 45_000)

  if (result.error) {
    logger(`OpenClaw CLI extraction failed: ${result.error}`)
    return null
  }

  if (result.timedOut) {
    logger("OpenClaw CLI extraction timed out after 45s")
    return null
  }

  if (result.status !== 0) {
    const message = result.stderr.trim() || `exit code ${String(result.status)}`
    logger(`OpenClaw CLI extraction failed: ${message}`)
    return null
  }

  const parsedText = parseCliOutput(result.stdout)
  if (!parsedText.trim()) {
    logger("OpenClaw CLI extraction returned empty output")
    return null
  }

  return parseSummaryOutput(parsedText)
}

async function runGatewayCompletionSummary(
  conversation: string,
  cfg: unknown,
  model: string | null,
  logger: (message: string) => void,
): Promise<SessionSummary | null> {
  if (!model) {
    logger("Skipping gateway extraction because no model is configured.")
    return null
  }

  const port = await readGatewayPort(cfg)

  try {
    const response = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: conversation },
        ],
      }),
    })

    if (!response.ok) {
      logger(`Gateway extraction failed with HTTP ${String(response.status)}`)
      return null
    }

    const payload = asRecord(await response.json())
    const choices = Array.isArray(payload.choices) ? payload.choices : []
    const firstChoice = choices[0]
    if (!firstChoice || typeof firstChoice !== "object") {
      logger("Gateway extraction returned no choices")
      return null
    }

    const message = asRecord((firstChoice as Record<string, unknown>).message)
    const content = contentToText(message.content)
    if (!content) {
      logger("Gateway extraction returned empty message content")
      return null
    }

    return parseSummaryOutput(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger(`Gateway extraction request failed: ${message}`)
    return null
  }
}

export async function extractSessionSummary(conversation: string, options: ExtractOptions): Promise<ExtractionResult> {
  const log = options.logger ?? (() => undefined)
  const configuredModel = options.model?.trim() || readModelFromConfig(options.cfg)

  const cliResult = await runOpenClawCliSummary(conversation, configuredModel, log)
  if (cliResult !== null) {
    return { success: true, summary: cliResult }
  }

  const gatewayResult = await runGatewayCompletionSummary(conversation, options.cfg, configuredModel, log)
  if (gatewayResult !== null) {
    return { success: true, summary: gatewayResult }
  }

  const message =
    configuredModel === null
      ? "Failed to extract session summary: no model configured in hook config or gateway defaults."
      : "Failed to extract session summary via OpenClaw CLI and gateway API fallback."

  log(message)
  return { success: false, summary: EMPTY_SUMMARY, message }
}
