import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { asStringArray } from "../lib/json"
import { OpenClawJobError, scheduleAgentCronJob, waitForCronSummary } from "../lib/openclaw-jobs"
import { pathExists } from "../lib/vault"
import type {
  MigratePipelineOptions,
  MigratePipelineResult,
  MigrateRunState,
  MigrateSubagentExtraction,
  MigrateTask,
  StoredMigrateTaskResult,
} from "./contracts"
import {
  buildMainSynthesisPrompt,
  buildSubagentPrompt,
  normalizeWikilinkToken,
  parseSubagentExtraction,
  wikilinkTitleFromToken,
} from "./prompt"

const SUBAGENT_SESSION_NAME = "zettelclaw-migrate-subagent"
const FINAL_SYNTHESIS_SESSION_NAME = "zettelclaw-migrate-synthesis"

export async function runMigratePipeline(options: MigratePipelineOptions): Promise<MigratePipelineResult> {
  const runKey = buildRunKey(options)
  const state = await loadState({
    statePath: options.statePath,
    runKey,
    workspacePath: options.workspacePath,
    vaultPath: options.vaultPath,
    model: options.model,
  })

  if (state.cleanupCompleted && options.tasks.length > 0) {
    resetState(state, runKey, options)
    await saveState(options.statePath, state)
  }

  const wikilinkTitles = await loadWikilinkIndex(join(options.vaultPath, options.notesFolder))
  for (const entry of Object.values(state.completed)) {
    mergeExtractionWikilinks(wikilinkTitles, entry.extraction)
  }

  let processedTasks = 0
  const skippedTasks = 0
  const failedTaskErrors: string[] = []
  const pendingTasks: MigrateTask[] = [...options.tasks]

  if (pendingTasks.length > 0) {
    const parallelJobs = resolveParallelJobs(options.parallelJobs, pendingTasks.length)
    let settledTasks = 0
    let activeJobs = 0
    let nextTaskIndex = 0
    let saveChain = Promise.resolve()

    options.onProgress?.(
      `Progress: 0/${pendingTasks.length} files complete (0 failed, 0 active, ${skippedTasks} skipped)`,
    )

    const enqueueStateSave = async (): Promise<void> => {
      saveChain = saveChain.then(() => saveState(options.statePath, state))
      await saveChain
    }

    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextTaskIndex
        nextTaskIndex += 1
        if (index >= pendingTasks.length) {
          return
        }

        const task = pendingTasks[index]
        if (!task) {
          return
        }

        activeJobs += 1
        try {
          const extraction = await runTaskMigration(task, {
            workspacePath: options.workspacePath,
            vaultPath: options.vaultPath,
            notesFolder: options.notesFolder,
            journalFolder: options.journalFolder,
            model: options.model,
            wikilinkTitles,
          })

          if (extraction.status !== "ok") {
            throw new Error(extraction.summary.length > 0 ? extraction.summary : "Sub-agent reported error status.")
          }

          if (!extraction.deletedSource && (await pathExists(task.sourcePath))) {
            throw new Error(`Source file was not deleted: ${task.relativePath}`)
          }

          const completedAt = new Date().toISOString()
          state.completed[task.id] = {
            taskId: task.id,
            relativePath: task.relativePath,
            extraction,
            completedAt,
          }
          state.updatedAt = completedAt
          mergeExtractionWikilinks(wikilinkTitles, extraction)
          await enqueueStateSave()
          processedTasks += 1
        } catch (error) {
          failedTaskErrors.push(formatTaskError(task, error))
        } finally {
          activeJobs -= 1
          settledTasks += 1
          options.onProgress?.(
            `Progress: ${settledTasks}/${pendingTasks.length} files complete (${failedTaskErrors.length} failed, ${activeJobs} active, ${skippedTasks} skipped)`,
          )
        }
      }
    }

    await Promise.all(Array.from({ length: parallelJobs }, () => worker()))
    await saveChain
  }

  if (failedTaskErrors.length > 0) {
    return {
      totalTasks: options.tasks.length,
      processedTasks,
      skippedTasks,
      failedTasks: failedTaskErrors.length,
      failedTaskErrors,
      finalSynthesisSummary: "",
      statePath: options.statePath,
      cleanupCompleted: state.cleanupCompleted,
      completedResults: selectCompletedResults(options.tasks, state),
    }
  }

  if (!state.finalSynthesisCompleted) {
    options.onProgress?.("Running final MEMORY.md/USER.md synthesis")
    const synthesisSummary = await runFinalSynthesis({
      workspacePath: options.workspacePath,
      vaultPath: options.vaultPath,
      notesFolder: options.notesFolder,
      journalFolder: options.journalFolder,
      model: options.model,
      completedResults: selectCompletedResults(options.tasks, state),
    })

    const memoryPath = join(options.workspacePath, "MEMORY.md")
    const userPath = join(options.workspacePath, "USER.md")
    const [hasMemory, hasUser] = await Promise.all([pathExists(memoryPath), pathExists(userPath)])
    if (!(hasMemory && hasUser)) {
      const missing = [hasMemory ? "" : memoryPath, hasUser ? "" : userPath].filter((entry) => entry.length > 0)
      throw new Error(`Final synthesis did not produce required file updates: ${missing.join(", ")}`)
    }

    state.finalSynthesisCompleted = true
    state.finalSynthesisSummary = synthesisSummary
    state.updatedAt = new Date().toISOString()
    await saveState(options.statePath, state)
  }

  if (!state.cleanupCompleted) {
    options.onProgress?.("Clearing migrated workspace memory directory")
    await clearMemoryDirectory(options.memoryPath)
    state.cleanupCompleted = true
    state.updatedAt = new Date().toISOString()
    await saveState(options.statePath, state)
  }

  return {
    totalTasks: options.tasks.length,
    processedTasks,
    skippedTasks,
    failedTasks: 0,
    failedTaskErrors: [],
    finalSynthesisSummary: state.finalSynthesisSummary ?? "",
    statePath: options.statePath,
    cleanupCompleted: state.cleanupCompleted,
    completedResults: selectCompletedResults(options.tasks, state),
  }
}

async function runTaskMigration(
  task: MigrateTask,
  options: {
    workspacePath: string
    vaultPath: string
    notesFolder: string
    journalFolder: string
    model: string
    wikilinkTitles: Set<string>
  },
): Promise<MigrateSubagentExtraction> {
  const prompt = await buildSubagentPrompt({
    task,
    workspacePath: options.workspacePath,
    vaultPath: options.vaultPath,
    notesFolder: options.notesFolder,
    journalFolder: options.journalFolder,
    wikilinkTitles: [...options.wikilinkTitles].sort((left, right) => left.localeCompare(right)),
  })

  const scheduled = await scheduleAgentCronJob({
    message: prompt,
    model: options.model,
    sessionName: SUBAGENT_SESSION_NAME,
    timeoutSeconds: 1800,
    sessionTarget: "isolated",
    deleteAfterRun: false,
  })

  try {
    const summary = await waitForCronSummary(scheduled.jobId, 1_900_000)
    return parseSubagentExtraction(summary, task)
  } catch (error) {
    if (error instanceof OpenClawJobError && error.details && error.details.trim().length > 0) {
      throw new Error(`${error.message} (${error.details})`)
    }

    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message)
  }
}

async function runFinalSynthesis(options: {
  workspacePath: string
  vaultPath: string
  notesFolder: string
  journalFolder: string
  model: string
  completedResults: StoredMigrateTaskResult[]
}): Promise<string> {
  const prompt = await buildMainSynthesisPrompt({
    workspacePath: options.workspacePath,
    vaultPath: options.vaultPath,
    notesFolder: options.notesFolder,
    journalFolder: options.journalFolder,
    model: options.model,
    completedResults: options.completedResults,
  })

  const scheduled = await scheduleAgentCronJob({
    message: prompt,
    model: options.model,
    sessionName: FINAL_SYNTHESIS_SESSION_NAME,
    timeoutSeconds: 1800,
    sessionTarget: "isolated",
    deleteAfterRun: false,
  })

  return waitForCronSummary(scheduled.jobId, 1_900_000)
}

async function loadWikilinkIndex(notesPath: string): Promise<Set<string>> {
  const titles = await listMarkdownTitles(notesPath)
  return new Set(titles)
}

function mergeExtractionWikilinks(index: Set<string>, extraction: MigrateSubagentExtraction): void {
  for (const wikilink of extraction.createdWikilinks) {
    const title = wikilinkTitleFromToken(wikilink)
    if (title) {
      index.add(title)
    }
  }

  for (const notePath of [...extraction.createdNotes, ...extraction.updatedNotes]) {
    const normalized = normalizeWikilinkToken(notePath)
    if (!normalized) {
      continue
    }

    const title = wikilinkTitleFromToken(normalized)
    if (title) {
      index.add(title)
    }
  }
}

async function clearMemoryDirectory(memoryPath: string): Promise<void> {
  await mkdir(memoryPath, { recursive: true })
  const entries = await readdir(memoryPath, { withFileTypes: true })
  await Promise.all(entries.map((entry) => rm(join(memoryPath, entry.name), { recursive: true, force: true })))

  const remaining = await readdir(memoryPath)
  if (remaining.length > 0) {
    throw new Error(`Could not fully clear memory directory: ${memoryPath}`)
  }
}

function formatTaskError(task: MigrateTask, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `${task.relativePath}: ${message}`
}

function selectCompletedResults(tasks: MigrateTask[], state: MigrateRunState): StoredMigrateTaskResult[] {
  return tasks
    .map((task) => state.completed[task.id])
    .filter((result): result is StoredMigrateTaskResult => result !== undefined)
}

function resolveParallelJobs(value: number | undefined, pendingCount: number): number {
  if (pendingCount <= 0) {
    return 1
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1
  }

  const normalized = Math.floor(value)
  if (normalized < 1) {
    return 1
  }

  return normalized > pendingCount ? pendingCount : normalized
}

function buildRunKey(options: Pick<MigratePipelineOptions, "workspacePath" | "vaultPath" | "model">): string {
  const hash = createHash("sha1")
  hash.update(options.workspacePath)
  hash.update(options.vaultPath)
  hash.update(options.model)
  hash.update("zettelclaw-migrate-v2")
  return hash.digest("hex")
}

async function loadState(input: {
  statePath: string
  runKey: string
  workspacePath: string
  vaultPath: string
  model: string
}): Promise<MigrateRunState> {
  let parsed: MigrateRunState | null = null

  try {
    const raw = await readFile(input.statePath, "utf8")
    parsed = parseState(JSON.parse(raw) as unknown)
  } catch {
    parsed = null
  }

  if (parsed && parsed.runKey === input.runKey) {
    return parsed
  }

  const now = new Date().toISOString()
  return {
    version: 1,
    runKey: input.runKey,
    workspacePath: input.workspacePath,
    vaultPath: input.vaultPath,
    model: input.model,
    createdAt: now,
    updatedAt: now,
    completed: {},
    finalSynthesisCompleted: false,
    cleanupCompleted: false,
  }
}

function resetState(state: MigrateRunState, runKey: string, options: MigratePipelineOptions): void {
  const now = new Date().toISOString()
  state.runKey = runKey
  state.workspacePath = options.workspacePath
  state.vaultPath = options.vaultPath
  state.model = options.model
  state.createdAt = now
  state.updatedAt = now
  state.completed = {}
  state.finalSynthesisCompleted = false
  state.finalSynthesisSummary = undefined
  state.cleanupCompleted = false
}

async function saveState(statePath: string, state: MigrateRunState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8")
}

function parseState(value: unknown): MigrateRunState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  if (record.version !== 1) {
    return null
  }

  if (
    typeof record.runKey !== "string" ||
    typeof record.workspacePath !== "string" ||
    typeof record.vaultPath !== "string" ||
    typeof record.model !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.finalSynthesisCompleted !== "boolean" ||
    typeof record.cleanupCompleted !== "boolean"
  ) {
    return null
  }

  const completedRaw = record.completed
  if (!completedRaw || typeof completedRaw !== "object" || Array.isArray(completedRaw)) {
    return null
  }

  const completed: Record<string, StoredMigrateTaskResult> = {}
  for (const [key, entry] of Object.entries(completedRaw)) {
    const parsed = parseStoredResult(entry)
    if (parsed) {
      completed[key] = parsed
    }
  }

  const state: MigrateRunState = {
    version: 1,
    runKey: record.runKey,
    workspacePath: record.workspacePath,
    vaultPath: record.vaultPath,
    model: record.model,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completed,
    finalSynthesisCompleted: record.finalSynthesisCompleted,
    cleanupCompleted: record.cleanupCompleted,
  }

  if (typeof record.finalSynthesisSummary === "string") {
    state.finalSynthesisSummary = record.finalSynthesisSummary
  }

  return state
}

function parseStoredResult(value: unknown): StoredMigrateTaskResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.taskId !== "string" ||
    typeof record.relativePath !== "string" ||
    typeof record.completedAt !== "string"
  ) {
    return null
  }

  const extraction = parseExtraction(record.extraction)
  if (!extraction) {
    return null
  }

  return {
    taskId: record.taskId,
    relativePath: record.relativePath,
    extraction,
    completedAt: record.completedAt,
  }
}

function parseExtraction(value: unknown): MigrateSubagentExtraction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.sourceFile !== "string" ||
    typeof record.summary !== "string" ||
    typeof record.deletedSource !== "boolean"
  ) {
    return null
  }

  const statusValue = record.status === "error" ? "error" : "ok"
  const createdWikilinks = asStringArray(record.createdWikilinks)
  const createdNotes = asStringArray(record.createdNotes)
  const updatedNotes = asStringArray(record.updatedNotes)
  const journalDaysTouched = asStringArray(record.journalDaysTouched)

  return {
    sourceFile: record.sourceFile,
    status: statusValue,
    summary: record.summary,
    createdWikilinks,
    createdNotes,
    updatedNotes,
    journalDaysTouched,
    deletedSource: record.deletedSource,
  }
}

async function listMarkdownTitles(rootPath: string): Promise<string[]> {
  if (!(await pathExists(rootPath))) {
    return []
  }

  const titles: string[] = []
  const stack = [rootPath]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absolutePath)
        continue
      }

      if (!(entry.isFile() && entry.name.toLowerCase().endsWith(".md"))) {
        continue
      }

      titles.push(entry.name.slice(0, -3))
    }
  }

  return uniqueStrings(titles)
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
