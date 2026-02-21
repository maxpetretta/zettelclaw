import { createHash } from "node:crypto"
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { dispatchVaultUpdateTask } from "./lib/extract"
import { JOURNAL_FOLDER_CANDIDATES, NOTES_FOLDER_CANDIDATES } from "./lib/folders"
import { asRecord } from "./lib/json"
import { type ConversationTurn, readRecentSessionMessagesWithSource, readSessionTurnsFromFile } from "./lib/session"
import { resolveVaultPath } from "./lib/vault-path"

interface HookEvent {
  type: string
  action: string
  sessionKey: string
  timestamp: Date
  messages: string[]
  context: {
    cfg?: unknown
    sessionEntry?: unknown
    previousSessionEntry?: unknown
    sessionId?: string
    sessionFile?: string
    commandSource?: string
    senderId?: string
    workspaceDir?: string
  }
}

type HookHandler = (event: HookEvent) => Promise<void>

interface SweepCursor {
  offset: number
  hash: string
  mtimeMs: number
  updatedAt: string
}

interface SweepState {
  version: number
  lastSweepAt?: string
  files: Record<string, SweepCursor>
}

interface SweepRunResult {
  ran: boolean
  processedFiles: number
  dispatchedTasks: number
  failedFiles: number
  stateChanged: boolean
}

interface SweepConfig {
  enabled: boolean
  intervalMinutes: number
  messages: number
  maxFiles: number
  staleMinutes: number
}

interface ExtractResult {
  success: boolean
  dispatched: boolean
  message?: string
}

interface TranscriptCandidate {
  path: string
  mtimeMs: number
}

const HOOK_STATE_VERSION = 1
const DEFAULT_SWEEP_INTERVAL_MINUTES = 30
const DEFAULT_SWEEP_MESSAGES = 120
const DEFAULT_SWEEP_MAX_FILES = 40
const DEFAULT_SWEEP_STALE_MINUTES = 180
const MAX_SWEEP_STATE_ENTRIES = 4_000
const DEFAULT_EXPECT_FINAL = false

interface JournalSnapshot {
  journalPath: string
  journalFilename: string
  content: string
}

function logWarning(message: string): void {
  console.warn(`[zettelclaw hook] ${message}`)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function toDate(value: unknown): Date {
  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value
  }

  if (typeof value === "string") {
    const parsed = new Date(value)
    if (Number.isFinite(parsed.valueOf())) {
      return parsed
    }
  }

  return new Date()
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parsePositiveInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(maximum, Math.max(minimum, Math.floor(value)))
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return Math.min(maximum, Math.max(minimum, parsed))
    }
  }

  return fallback
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (normalized === "true") {
      return true
    }

    if (normalized === "false") {
      return false
    }
  }

  return fallback
}

function parseMessageCount(configValue: unknown): number {
  return parsePositiveInt(configValue, 20, 1, 200)
}

function parseSweepConfig(hookConfig: Record<string, unknown>): SweepConfig {
  return {
    enabled: parseBoolean(hookConfig.sweepEnabled, true),
    intervalMinutes: parsePositiveInt(hookConfig.sweepEveryMinutes, DEFAULT_SWEEP_INTERVAL_MINUTES, 5, 1_440),
    messages: parsePositiveInt(hookConfig.sweepMessages, DEFAULT_SWEEP_MESSAGES, 10, 400),
    maxFiles: parsePositiveInt(hookConfig.sweepMaxFiles, DEFAULT_SWEEP_MAX_FILES, 1, 500),
    staleMinutes: parsePositiveInt(hookConfig.sweepStaleMinutes, DEFAULT_SWEEP_STALE_MINUTES, 5, 10_080),
  }
}

async function resolveNotesDirectory(vaultPath: string): Promise<string | null> {
  for (const folder of NOTES_FOLDER_CANDIDATES) {
    const candidate = join(vaultPath, folder)
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return null
}

async function resolveJournalDirectory(vaultPath: string): Promise<string> {
  for (const folder of JOURNAL_FOLDER_CANDIDATES) {
    const candidate = join(vaultPath, folder)
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return join(vaultPath, JOURNAL_FOLDER_CANDIDATES[0])
}

function parseExpectFinal(configValue: unknown): boolean {
  return parseBoolean(configValue, DEFAULT_EXPECT_FINAL)
}

async function readJournalSnapshot(vaultPath: string, timestamp: Date): Promise<JournalSnapshot> {
  const journalDir = await resolveJournalDirectory(vaultPath)
  const dateStamp = formatDate(timestamp)
  const journalFilename = `${dateStamp}.md`
  const journalPath = join(journalDir, journalFilename)

  let content = ""
  try {
    if (await pathExists(journalPath)) {
      content = await readFile(journalPath, "utf8")
    }
  } catch {
    // If journal read fails, continue with an empty journal snapshot.
  }

  return {
    journalPath,
    journalFilename,
    content,
  }
}

function buildConversationTranscript(turns: ConversationTurn[]): string {
  return turns
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
    .join("\n\n")
    .trim()
}

function isResetEvent(event: HookEvent): boolean {
  const eventType = event.type.toLowerCase()
  const eventAction = event.action.toLowerCase()

  return (
    eventType === "command:new" ||
    eventType === "command:reset" ||
    (eventType === "command" && (eventAction === "new" || eventAction === "reset"))
  )
}

function isIsolatedSession(sessionKey: string): boolean {
  const normalized = sessionKey.toLowerCase()
  return normalized === "isolated" || normalized.endsWith(":isolated") || normalized.includes(":isolated:")
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return homedir()
  }

  if (inputPath.startsWith("~/")) {
    return resolve(homedir(), inputPath.slice(2))
  }

  return inputPath
}

function resolveOpenClawStateDir(): string {
  const envPath = process.env.OPENCLAW_STATE_DIR
  if (typeof envPath === "string" && envPath.trim().length > 0) {
    return resolve(expandHome(envPath.trim()))
  }

  return join(homedir(), ".openclaw")
}

function resolveWorkspaceDir(cfg: unknown, eventWorkspaceDir: unknown): string {
  if (typeof eventWorkspaceDir === "string" && eventWorkspaceDir.trim().length > 0) {
    return resolve(expandHome(eventWorkspaceDir.trim()))
  }

  const cfgRecord = asRecord(cfg)
  const directWorkspace = cfgRecord.workspace
  if (typeof directWorkspace === "string" && directWorkspace.trim().length > 0) {
    return resolve(expandHome(directWorkspace.trim()))
  }

  const agents = asRecord(cfgRecord.agents)
  const defaults = asRecord(agents.defaults)
  const defaultsWorkspace = defaults.workspace
  if (typeof defaultsWorkspace === "string" && defaultsWorkspace.trim().length > 0) {
    return resolve(expandHome(defaultsWorkspace.trim()))
  }

  return join(resolveOpenClawStateDir(), "workspace")
}

function resolveHookStatePath(): string {
  return join(resolveOpenClawStateDir(), "hooks", "zettelclaw", "state.json")
}

function createEmptySweepState(): SweepState {
  return {
    version: HOOK_STATE_VERSION,
    files: {},
  }
}

async function loadSweepState(statePath: string): Promise<SweepState> {
  try {
    const raw = await readFile(statePath, "utf8")
    const parsed = asRecord(JSON.parse(raw))
    const filesRecord = asRecord(parsed.files)

    const files: Record<string, SweepCursor> = {}

    for (const [filePath, rawCursor] of Object.entries(filesRecord)) {
      const cursor = asRecord(rawCursor)
      const offset =
        typeof cursor.offset === "number" && Number.isFinite(cursor.offset) ? Math.max(0, cursor.offset) : 0
      const hash = typeof cursor.hash === "string" ? cursor.hash : ""
      const mtimeMs = typeof cursor.mtimeMs === "number" && Number.isFinite(cursor.mtimeMs) ? cursor.mtimeMs : 0
      const updatedAt = typeof cursor.updatedAt === "string" ? cursor.updatedAt : new Date(0).toISOString()

      if (hash.length === 0) {
        continue
      }

      files[filePath] = {
        offset,
        hash,
        mtimeMs,
        updatedAt,
      }
    }

    const state: SweepState = {
      version: HOOK_STATE_VERSION,
      files,
    }

    if (typeof parsed.lastSweepAt === "string") {
      state.lastSweepAt = parsed.lastSweepAt
    }

    return state
  } catch {
    return createEmptySweepState()
  }
}

async function saveSweepState(statePath: string, state: SweepState): Promise<void> {
  const trimmedEntries = Object.entries(state.files)

  if (trimmedEntries.length > MAX_SWEEP_STATE_ENTRIES) {
    trimmedEntries.sort((a, b) => {
      const left = Date.parse(a[1].updatedAt)
      const right = Date.parse(b[1].updatedAt)
      return right - left
    })

    state.files = Object.fromEntries(trimmedEntries.slice(0, MAX_SWEEP_STATE_ENTRIES))
  }

  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8")
}

function hashTurns(turns: ConversationTurn[]): string {
  const hash = createHash("sha256")

  for (const turn of turns) {
    hash.update(turn.role)
    hash.update("\u0000")
    hash.update(turn.content)
    hash.update("\u0000")
  }

  return hash.digest("hex")
}

function extractSessionFilePath(entryValue: unknown): string | null {
  const entry = asRecord(entryValue)
  const sessionFile = entry.sessionFile

  if (typeof sessionFile === "string" && sessionFile.trim().length > 0) {
    return resolve(sessionFile)
  }

  return null
}

async function resolveSessionDirectories(event: HookEvent, cfg: unknown): Promise<string[]> {
  const stateDir = resolveOpenClawStateDir()
  const context = asRecord(event.context)
  const workspaceDir = resolveWorkspaceDir(cfg, context.workspaceDir)

  const directories = new Set<string>()

  const contextSessionFile = context.sessionFile
  if (typeof contextSessionFile === "string" && contextSessionFile.trim().length > 0) {
    directories.add(dirname(resolve(contextSessionFile)))
  }

  const entrySessionFile = extractSessionFilePath(context.sessionEntry)
  if (entrySessionFile) {
    directories.add(dirname(entrySessionFile))
  }

  const previousSessionFile = extractSessionFilePath(context.previousSessionEntry)
  if (previousSessionFile) {
    directories.add(dirname(previousSessionFile))
  }

  directories.add(join(workspaceDir, "sessions"))
  directories.add(join(stateDir, "workspace", "sessions"))

  const agentsDir = join(stateDir, "agents")
  if (await isDirectory(agentsDir)) {
    try {
      const agentEntries = await readdir(agentsDir, { withFileTypes: true })
      for (const agentEntry of agentEntries) {
        if (!agentEntry.isDirectory()) {
          continue
        }

        directories.add(join(agentsDir, agentEntry.name, "sessions"))
      }
    } catch {
      // Ignore agent directory scan failures.
    }
  }

  const existingDirectories: string[] = []
  for (const candidate of directories) {
    if (await isDirectory(candidate)) {
      existingDirectories.push(candidate)
    }
  }

  existingDirectories.sort((left, right) => left.localeCompare(right))
  return existingDirectories
}

function isTranscriptFilename(name: string): boolean {
  return /\.jsonl(?:\.reset\..+)?$/u.test(name)
}

async function collectTranscriptCandidates(
  sessionDirs: string[],
  staleMinutes: number,
): Promise<TranscriptCandidate[]> {
  const staleCutoffMs = Date.now() - staleMinutes * 60_000
  const candidates = new Map<string, TranscriptCandidate>()

  for (const sessionDir of sessionDirs) {
    const entries = await readdir(sessionDir, { withFileTypes: true, encoding: "utf8" }).catch(() => null)
    if (!entries) {
      continue
    }

    for (const entry of entries) {
      if (!(entry.isFile() && isTranscriptFilename(entry.name))) {
        continue
      }

      const transcriptPath = resolve(join(sessionDir, entry.name))
      let transcriptStat: Awaited<ReturnType<typeof stat>>

      try {
        transcriptStat = await stat(transcriptPath)
      } catch {
        continue
      }

      if (!entry.name.includes(".reset.") && transcriptStat.mtimeMs > staleCutoffMs) {
        continue
      }

      const existing = candidates.get(transcriptPath)
      if (!existing || transcriptStat.mtimeMs > existing.mtimeMs) {
        candidates.set(transcriptPath, {
          path: transcriptPath,
          mtimeMs: transcriptStat.mtimeMs,
        })
      }
    }
  }

  const sorted = [...candidates.values()]
  sorted.sort((left, right) => left.mtimeMs - right.mtimeMs)
  return sorted
}

function updateSweepCursor(
  state: SweepState,
  transcriptPath: string,
  turns: ConversationTurn[],
  mtimeMs: number,
  timestamp: string,
): boolean {
  const cursor: SweepCursor = {
    offset: turns.length,
    hash: hashTurns(turns),
    mtimeMs,
    updatedAt: timestamp,
  }

  const previous = state.files[transcriptPath]
  if (
    previous &&
    previous.offset === cursor.offset &&
    previous.hash === cursor.hash &&
    previous.mtimeMs === cursor.mtimeMs &&
    previous.updatedAt === cursor.updatedAt
  ) {
    return false
  }

  state.files[transcriptPath] = cursor
  return true
}

function shouldRunSweep(state: SweepState, intervalMinutes: number): boolean {
  if (!state.lastSweepAt) {
    return true
  }

  const lastSweepMs = Date.parse(state.lastSweepAt)
  if (!Number.isFinite(lastSweepMs)) {
    return true
  }

  return Date.now() - lastSweepMs >= intervalMinutes * 60_000
}

async function dispatchVaultUpdateFromTurns(
  turns: ConversationTurn[],
  timestamp: Date,
  hookConfig: Record<string, unknown>,
  vaultPath: string,
  notesDirectory: string,
  conversationSource: "command-reset" | "sweep",
  sessionId: string | undefined,
  transcriptPath: string | undefined,
  expectFinal: boolean,
): Promise<ExtractResult> {
  if (turns.length === 0) {
    return { success: true, dispatched: false, message: "No extractable insights from this session" }
  }

  const transcript = buildConversationTranscript(turns)
  if (transcript.length === 0) {
    return { success: true, dispatched: false, message: "No extractable insights from this session" }
  }

  const journal = await readJournalSnapshot(vaultPath, timestamp)
  const request = {
    conversation: transcript,
    conversationSource,
    timestampIso: timestamp.toISOString(),
    vaultPath,
    notesDirectory,
    journalFilename: journal.journalFilename,
    journalPath: journal.journalPath,
    journalContent: journal.content,
    ...(typeof sessionId === "string" && sessionId.length > 0 ? { sessionId } : {}),
    ...(typeof transcriptPath === "string" && transcriptPath.length > 0 ? { transcriptPath } : {}),
  }

  const dispatch = await dispatchVaultUpdateTask(request, {
    expectFinal,
    model: typeof hookConfig.model === "string" ? hookConfig.model : undefined,
    logger: logWarning,
  })

  if (!dispatch.success) {
    return { success: false, dispatched: false, message: dispatch.message ?? "Could not dispatch vault update task" }
  }

  if (typeof dispatch.message === "string" && dispatch.message.length > 0) {
    return {
      success: true,
      dispatched: true,
      message: dispatch.message,
    }
  }

  return { success: true, dispatched: true }
}

async function processResetEventSession(
  event: HookEvent,
  hookConfig: Record<string, unknown>,
  vaultPath: string,
  notesDirectory: string,
  state: SweepState,
): Promise<{ message?: string; stateChanged: boolean }> {
  const messageLimit = parseMessageCount(hookConfig.messages)
  const expectFinal = parseExpectFinal(hookConfig.expectFinal)
  const session = await readRecentSessionMessagesWithSource(event, messageLimit)

  if (session.turns.length === 0) {
    return { message: "🦞 No extractable insights from this session", stateChanged: false }
  }

  const eventDate = toDate(event.timestamp)
  const extraction = await dispatchVaultUpdateFromTurns(
    session.turns,
    eventDate,
    hookConfig,
    vaultPath,
    notesDirectory,
    "command-reset",
    event.context?.sessionId,
    session.sourceFile ?? undefined,
    expectFinal,
  )

  if (!extraction.success) {
    return {
      message: `🦞 ${extraction.message ?? "Could not dispatch vault update task"}`,
      stateChanged: false,
    }
  }

  let stateChanged = false

  if (session.sourceFile) {
    try {
      const allTurns = await readSessionTurnsFromFile(session.sourceFile)
      const transcriptStat = await stat(session.sourceFile)
      stateChanged = updateSweepCursor(
        state,
        session.sourceFile,
        allTurns,
        transcriptStat.mtimeMs,
        new Date().toISOString(),
      )
    } catch {
      // If cursor update fails, sweep will catch up on next pass.
    }
  }

  return {
    message: `🦞 ${extraction.message ?? (expectFinal ? "Vault update completed" : "Vault update task dispatched")}`,
    stateChanged,
  }
}

async function runTranscriptSweep(
  event: HookEvent,
  cfg: unknown,
  hookConfig: Record<string, unknown>,
  vaultPath: string,
  notesDirectory: string,
  state: SweepState,
): Promise<SweepRunResult> {
  const sweepConfig = parseSweepConfig(hookConfig)

  if (!(sweepConfig.enabled && shouldRunSweep(state, sweepConfig.intervalMinutes))) {
    return {
      ran: false,
      processedFiles: 0,
      dispatchedTasks: 0,
      failedFiles: 0,
      stateChanged: false,
    }
  }

  const nowIso = new Date().toISOString()
  let stateChanged = false

  state.lastSweepAt = nowIso
  stateChanged = true

  const sessionDirs = await resolveSessionDirectories(event, cfg)
  if (sessionDirs.length === 0) {
    return {
      ran: true,
      processedFiles: 0,
      dispatchedTasks: 0,
      failedFiles: 0,
      stateChanged,
    }
  }

  const candidates = await collectTranscriptCandidates(sessionDirs, sweepConfig.staleMinutes)
  let processedFiles = 0
  let dispatchedTasks = 0
  let failedFiles = 0
  let examinedFiles = 0

  for (const candidate of candidates) {
    const previous = state.files[candidate.path]

    if (previous && previous.mtimeMs === candidate.mtimeMs) {
      continue
    }

    if (examinedFiles >= sweepConfig.maxFiles) {
      break
    }

    examinedFiles += 1

    const turns = await readSessionTurnsFromFile(candidate.path)

    if (turns.length === 0) {
      const changed = updateSweepCursor(state, candidate.path, turns, candidate.mtimeMs, nowIso)
      stateChanged = stateChanged || changed
      continue
    }

    let startOffset = 0

    if (previous && previous.offset > 0 && previous.offset <= turns.length) {
      const currentPrefixHash = hashTurns(turns.slice(0, previous.offset))
      if (currentPrefixHash === previous.hash) {
        startOffset = previous.offset
      }
    }

    const pendingTurns = turns.slice(startOffset)

    if (pendingTurns.length < 2) {
      const changed = updateSweepCursor(state, candidate.path, turns, candidate.mtimeMs, nowIso)
      stateChanged = stateChanged || changed
      continue
    }

    const extractionTurns = pendingTurns.slice(-sweepConfig.messages)
    const extractionTimestamp = new Date(candidate.mtimeMs)
    const extraction = await dispatchVaultUpdateFromTurns(
      extractionTurns,
      extractionTimestamp,
      hookConfig,
      vaultPath,
      notesDirectory,
      "sweep",
      undefined,
      candidate.path,
      false,
    )

    if (!extraction.success) {
      failedFiles += 1
      continue
    }

    const changed = updateSweepCursor(state, candidate.path, turns, candidate.mtimeMs, nowIso)
    stateChanged = stateChanged || changed

    processedFiles += 1
    if (extraction.dispatched) {
      dispatchedTasks += 1
    }
  }

  return {
    ran: true,
    processedFiles,
    dispatchedTasks,
    failedFiles,
    stateChanged,
  }
}

export const handler: HookHandler = async (event) => {
  try {
    if (!isResetEvent(event)) {
      return
    }

    const cfg = event.context?.cfg ?? {}
    const hooks = asRecord(asRecord(asRecord(cfg).hooks).internal)
    const entries = asRecord(hooks.entries)
    const hookConfig = asRecord(entries.zettelclaw)

    const vaultPath = await resolveVaultPath(cfg, hookConfig)
    if (!vaultPath) {
      const message = "No vault path found; skipping vault update dispatch."
      logWarning(message)
      event.messages.push(`🦞 ${message}`)
      return
    }

    const notesDirectory = await resolveNotesDirectory(vaultPath)
    if (!notesDirectory) {
      const message = `No Notes folder found in vault: ${vaultPath}`
      logWarning(message)
      event.messages.push(`🦞 ${message}`)
      return
    }

    const statePath = resolveHookStatePath()
    const state = await loadSweepState(statePath)
    let stateChanged = false

    if (!isIsolatedSession(event.sessionKey)) {
      const resetResult = await processResetEventSession(event, hookConfig, vaultPath, notesDirectory, state)
      if (resetResult.message) {
        event.messages.push(resetResult.message)
      }
      stateChanged = stateChanged || resetResult.stateChanged
    }

    const sweepResult = await runTranscriptSweep(event, cfg, hookConfig, vaultPath, notesDirectory, state)
    stateChanged = stateChanged || sweepResult.stateChanged

    if (sweepResult.ran && sweepResult.processedFiles > 0) {
      const dispatchSuffix =
        sweepResult.dispatchedTasks > 0 ? `, dispatched ${sweepResult.dispatchedTasks} vault update tasks` : ""
      event.messages.push(`🦞 Sweep backfilled ${sweepResult.processedFiles} session files${dispatchSuffix}`)
    }

    if (sweepResult.failedFiles > 0) {
      event.messages.push(`🦞 Sweep skipped ${sweepResult.failedFiles} files due to dispatch errors`)
    }

    if (stateChanged) {
      try {
        await saveSweepState(statePath, state)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logWarning(`Could not persist sweep state: ${message}`)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logWarning(`Unexpected error: ${message}`)
    event.messages.push(`🦞 Hook failed: ${message}`)
  }
}

export default handler
