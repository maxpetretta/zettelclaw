import { readFile } from "node:fs/promises"

import { resolveSkillPath } from "../lib/skill"
import { substituteTemplate } from "../lib/template"
import type { MigrateSubagentExtraction, MigrateTask, StoredMigrateTaskResult } from "./contracts"

const DAILY_TEMPLATE_PATH = resolveSkillPath("templates", "migrate-subagent-daily-event.md")
const OTHER_TEMPLATE_PATH = resolveSkillPath("templates", "migrate-subagent-other-event.md")
const MAIN_SYNTHESIS_TEMPLATE_PATH = resolveSkillPath("templates", "migrate-main-synthesis-event.md")
const MAX_SUBAGENT_WIKILINK_TITLES = 40
const MAIN_SYNTHESIS_SUMMARY_BUDGET = 32_000

const templateCache = new Map<string, string>()

export interface BuildSubagentPromptOptions {
  task: MigrateTask
  workspacePath: string
  vaultPath: string
  notesFolder: string
  journalFolder: string
  wikilinkTitles: string[]
  wikilinkTitlesNormalized?: boolean
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
  const selectedWikilinks = selectWikilinksForTask(
    options.task,
    options.wikilinkTitles,
    MAX_SUBAGENT_WIKILINK_TITLES,
    options.wikilinkTitlesNormalized === true,
  )

  return substituteTemplate(template, {
    VAULT_PATH: options.vaultPath,
    WORKSPACE_PATH: options.workspacePath,
    NOTES_FOLDER: options.notesFolder,
    JOURNAL_FOLDER: options.journalFolder,
    SOURCE_PATH: options.task.sourcePath,
    SOURCE_RELATIVE_PATH: options.task.relativePath,
    FILE_BASENAME: options.task.basename,
    DAY: day,
    WIKILINK_INDEX: formatWikilinkIndex(selectedWikilinks),
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
    SUBAGENT_SUMMARIES: serializeSubagentSummaries(options.completedResults, MAIN_SYNTHESIS_SUMMARY_BUDGET),
  })
}

export function parseSubagentExtraction(summary: string, task: MigrateTask): MigrateSubagentExtraction {
  const candidates = collectJsonCandidates(summary)
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const extraction = parseStrictSummaryObject(parsed)
      if (extraction) {
        return extraction
      }
    } catch {
      // Keep trying other candidates.
    }
  }

  throw new Error(
    `Could not parse strict migration sub-agent output for ${task.relativePath}. Expected JSON exactly like {"summary":"..."}.`,
  )
}

export function normalizeAndSortWikilinkTitles(titles: string[]): string[] {
  return uniqueStrings(titles.map((title) => title.trim()).filter((title) => title.length > 0)).sort((a, b) =>
    a.localeCompare(b),
  )
}

function parseStrictSummaryObject(value: unknown): MigrateSubagentExtraction | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1 || keys[0] !== "summary") {
    return undefined
  }

  if (typeof record.summary !== "string") {
    return undefined
  }

  const normalizedSummary = record.summary.replaceAll(/\s+/gu, " ").trim()
  if (normalizedSummary.length === 0) {
    return undefined
  }

  return {
    summary: normalizedSummary,
  }
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

function selectWikilinksForTask(
  task: MigrateTask,
  titles: string[],
  limit: number,
  normalizedInput: boolean,
): string[] {
  if (limit < 1) {
    return []
  }

  const deduped = normalizedInput ? titles : normalizeAndSortWikilinkTitles(titles)
  if (deduped.length <= limit) {
    return deduped
  }

  const taskTokens = extractTaskTokens(task)
  if (taskTokens.length === 0) {
    return deduped.slice(0, limit)
  }

  const matched: string[] = []
  const unmatched: string[] = []

  for (const title of deduped) {
    const normalized = title.toLowerCase()
    if (taskTokens.some((token) => normalized.includes(token))) {
      matched.push(title)
      continue
    }
    unmatched.push(title)
  }

  return [...matched, ...unmatched].slice(0, limit)
}

function extractTaskTokens(task: MigrateTask): string[] {
  const seed = `${task.relativePath} ${task.basename}`.toLowerCase()
  const parts = seed.split(/[^a-z0-9]+/u)
  return uniqueStrings(parts.filter((part) => part.length >= 3 && /[a-z]/u.test(part)))
}

function serializeSubagentSummaries(results: StoredMigrateTaskResult[], maxChars: number): string {
  const sorted = [...results].sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const lines: string[] = []
  let consumed = 0

  for (const result of sorted) {
    const summaryText = result.extraction.summary.replaceAll(/\s+/gu, " ").trim() || "n/a"
    const line = `- ${result.relativePath} | summary: ${summaryText}`

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
