import { readFile } from "node:fs/promises"

import { asRecord } from "../lib/json"
import { resolveSkillPath } from "../lib/skill"
import { substituteTemplate } from "../lib/template"
import type { MigrateSubagentExtraction, MigrateTask, StoredMigrateTaskResult } from "./contracts"

const DAILY_TEMPLATE_PATH = resolveSkillPath("templates", "migrate-subagent-daily-event.md")
const OTHER_TEMPLATE_PATH = resolveSkillPath("templates", "migrate-subagent-other-event.md")
const MAIN_SYNTHESIS_TEMPLATE_PATH = resolveSkillPath("templates", "migrate-main-synthesis-event.md")

const templateCache = new Map<string, string>()

export interface BuildSubagentPromptOptions {
  task: MigrateTask
  workspacePath: string
  vaultPath: string
  notesFolder: string
  journalFolder: string
  wikilinkTitles: string[]
}

export interface BuildMainSynthesisPromptOptions {
  workspacePath: string
  vaultPath: string
  notesFolder: string
  journalFolder: string
  model: string
  completedResults: StoredMigrateTaskResult[]
}

export async function buildSubagentPrompt(options: BuildSubagentPromptOptions): Promise<string> {
  const templatePath = options.task.kind === "daily" ? DAILY_TEMPLATE_PATH : OTHER_TEMPLATE_PATH
  const template = await loadTemplate(templatePath)

  const day = options.task.kind === "daily" ? options.task.basename.slice(0, 10) : ""

  return substituteTemplate(template, {
    VAULT_PATH: options.vaultPath,
    WORKSPACE_PATH: options.workspacePath,
    NOTES_FOLDER: options.notesFolder,
    JOURNAL_FOLDER: options.journalFolder,
    SOURCE_PATH: options.task.sourcePath,
    SOURCE_RELATIVE_PATH: options.task.relativePath,
    FILE_BASENAME: options.task.basename,
    DAY: day,
    WIKILINK_INDEX: formatWikilinkIndex(options.wikilinkTitles),
  })
}

export async function buildMainSynthesisPrompt(options: BuildMainSynthesisPromptOptions): Promise<string> {
  const template = await loadTemplate(MAIN_SYNTHESIS_TEMPLATE_PATH)

  return substituteTemplate(template, {
    VAULT_PATH: options.vaultPath,
    WORKSPACE_PATH: options.workspacePath,
    NOTES_FOLDER: options.notesFolder,
    JOURNAL_FOLDER: options.journalFolder,
    MODEL: options.model,
    SUBAGENT_SUMMARIES: serializeSubagentSummaries(options.completedResults, 56_000),
  })
}

export function parseSubagentExtraction(summary: string, task: MigrateTask): MigrateSubagentExtraction {
  const jsonCandidates = collectJsonCandidates(summary)
  for (const candidate of jsonCandidates) {
    try {
      const parsedValue = JSON.parse(candidate) as unknown
      const parsed = parseExtractionObject(parsedValue, task.relativePath)
      if (parsed) {
        return parsed
      }
    } catch {
      // Keep trying other candidates.
    }
  }

  const sectionStyle = parseSectionStyleSummary(summary, task.relativePath)
  if (sectionStyle) {
    return sectionStyle
  }

  const normalized = summary.replaceAll(/\s+/gu, " ").trim()
  if (normalized.length > 0) {
    return {
      sourceFile: task.relativePath,
      status: "ok",
      summary: normalized,
      createdWikilinks: [],
      createdNotes: [],
      updatedNotes: [],
      journalDaysTouched: [],
      deletedSource: false,
    }
  }

  throw new Error(`Could not parse migration sub-agent output for ${task.relativePath}.`)
}

export function wikilinkTitleFromToken(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  const innerMatch = trimmed.match(/\[\[([^[\]]+)\]\]/u)
  const candidate = innerMatch?.[1] ?? trimmed
  const [beforeAlias] = candidate.split("|")
  const [beforeHeading] = (beforeAlias ?? "").split("#")
  const withoutPath = (beforeHeading ?? "").split("/").at(-1)?.trim() ?? ""
  const withoutExtension = withoutPath.replace(/\.md$/iu, "").trim()

  return withoutExtension.length > 0 ? withoutExtension : undefined
}

export function normalizeWikilinkToken(value: string): string | undefined {
  const title = wikilinkTitleFromToken(value)
  return title ? `[[${title}]]` : undefined
}

function parseExtractionObject(value: unknown, fallbackSourceFile: string): MigrateSubagentExtraction | undefined {
  const record = asRecord(value)
  if (Object.keys(record).length === 0) {
    return undefined
  }

  const sourceFileValue = readString(record, ["sourceFile", "source_file", "file"])
  const sourceFile = sourceFileValue?.trim().length ? sourceFileValue.trim() : fallbackSourceFile

  const statusValue = (readString(record, ["status"]) ?? "ok").trim().toLowerCase()
  const status = statusValue === "error" ? "error" : "ok"

  const summary = (readString(record, ["summary", "Summary"]) ?? "").replaceAll(/\s+/gu, " ").trim()
  const createdWikilinks = uniqueStrings(
    parseStringList(record, ["createdWikilinks", "created_wikilinks", "Created Wikilinks"])
      .map((entry) => normalizeWikilinkToken(entry))
      .filter((entry): entry is string => typeof entry === "string"),
  )
  const createdNotes = uniqueStrings(
    parseStringList(record, ["createdNotes", "created_notes", "Created Notes"]).map((entry) =>
      normalizePathValue(entry),
    ),
  )
  const updatedNotes = uniqueStrings(
    parseStringList(record, ["updatedNotes", "updated_notes", "Updated Notes"]).map((entry) =>
      normalizePathValue(entry),
    ),
  )
  const journalDaysTouched = uniqueStrings(
    parseStringList(record, ["journalDaysTouched", "journal_days_touched", "Journal Days Touched"])
      .map((entry) => entry.trim())
      .filter((entry) => /^\d{4}-\d{2}-\d{2}$/u.test(entry)),
  )

  const deletedSource = record.deletedSource === true || record.deleted_source === true

  return {
    sourceFile,
    status,
    summary,
    createdWikilinks,
    createdNotes,
    updatedNotes,
    journalDaysTouched,
    deletedSource,
  }
}

function parseSectionStyleSummary(summary: string, sourceFile: string): MigrateSubagentExtraction | undefined {
  const lines = summary.replaceAll("\r\n", "\n").split("\n")
  let summaryLine = ""
  const createdWikilinks: string[] = []
  let inCreatedWikilinks = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) {
      continue
    }

    if (line.toLowerCase().startsWith("summary:")) {
      summaryLine = line.slice("summary:".length).trim()
      inCreatedWikilinks = false
      continue
    }

    if (line.toLowerCase().startsWith("created wikilinks:")) {
      const remainder = line.slice("created wikilinks:".length).trim()
      if (remainder.length > 0) {
        createdWikilinks.push(...splitLooseList(remainder))
      }
      inCreatedWikilinks = true
      continue
    }

    if (inCreatedWikilinks) {
      if (line.startsWith("- ")) {
        createdWikilinks.push(line.slice(2).trim())
        continue
      }

      if (line.includes("[[")) {
        createdWikilinks.push(...splitLooseList(line))
        continue
      }

      inCreatedWikilinks = false
    }
  }

  const normalizedLinks = uniqueStrings(
    createdWikilinks
      .map((entry) => normalizeWikilinkToken(entry))
      .filter((entry): entry is string => typeof entry === "string"),
  )
  const normalizedSummary = summaryLine.replaceAll(/\s+/gu, " ").trim()

  if (normalizedSummary.length === 0 && normalizedLinks.length === 0) {
    return undefined
  }

  return {
    sourceFile,
    status: "ok",
    summary: normalizedSummary,
    createdWikilinks: normalizedLinks,
    createdNotes: [],
    updatedNotes: [],
    journalDaysTouched: [],
    deletedSource: false,
  }
}

function parseStringList(record: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    }

    if (typeof value === "string") {
      return splitLooseList(value)
    }
  }

  return []
}

function splitLooseList(value: string): string[] {
  return value
    .split(/\r?\n|,/u)
    .map((entry) => entry.replace(/^-\s*/u, "").trim())
    .filter((entry) => entry.length > 0)
}

function collectJsonCandidates(summary: string): string[] {
  const candidates: string[] = []
  const trimmed = summary.trim()
  if (trimmed.length > 0) {
    candidates.push(trimmed)
  }

  const fencedMatches = [...summary.matchAll(/```(?:json)?\s*([\s\S]*?)```/gu)]
  for (const match of fencedMatches) {
    const body = match[1]?.trim()
    if (body && body.length > 0) {
      candidates.push(body)
    }
  }

  const firstBrace = summary.indexOf("{")
  const lastBrace = summary.lastIndexOf("}")
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const objectSlice = summary.slice(firstBrace, lastBrace + 1).trim()
    if (objectSlice.length > 0) {
      candidates.push(objectSlice)
    }
  }

  return uniqueStrings(candidates)
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string") {
      return value
    }
  }

  return undefined
}

async function loadTemplate(path: string): Promise<string> {
  const cached = templateCache.get(path)
  if (cached) {
    return cached
  }

  const template = await readFile(path, "utf8")
  templateCache.set(path, template)
  return template
}

function formatWikilinkIndex(titles: string[]): string {
  const uniqueTitles = uniqueStrings(titles.map((title) => title.trim()).filter((title) => title.length > 0))
  if (uniqueTitles.length === 0) {
    return "- n/a"
  }

  return uniqueTitles.map((title) => `- [[${title}]]`).join("\n")
}

function serializeSubagentSummaries(results: StoredMigrateTaskResult[], maxChars: number): string {
  const sorted = [...results].sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const lines: string[] = []
  let consumed = 0

  for (const result of sorted) {
    const summaryText = result.extraction.summary.replaceAll(/\s+/gu, " ").trim() || "n/a"
    const links = result.extraction.createdWikilinks.length > 0 ? result.extraction.createdWikilinks.join(", ") : "n/a"
    const created = result.extraction.createdNotes.length > 0 ? result.extraction.createdNotes.join(", ") : "n/a"
    const updated = result.extraction.updatedNotes.length > 0 ? result.extraction.updatedNotes.join(", ") : "n/a"
    const line = `- ${result.relativePath} | summary: ${summaryText} | links: ${links} | created: ${created} | updated: ${updated}`

    if (consumed + line.length + 1 > maxChars) {
      lines.push(`- ... truncated after ${lines.length} files to stay within prompt budget.`)
      break
    }

    lines.push(line)
    consumed += line.length + 1
  }

  if (lines.length === 0) {
    return "- n/a"
  }

  return lines.join("\n")
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      continue
    }

    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    output.push(trimmed)
  }

  return output
}

function normalizePathValue(value: string): string {
  return value.trim().replaceAll("\\", "/")
}
