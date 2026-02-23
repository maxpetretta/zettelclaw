import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { rmSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resetSpawnSyncMock, spawnSyncMock } from "../../lib/__tests__/helpers/child-process-mock"

let runMigratePipeline: typeof import("../pipeline").runMigratePipeline

beforeAll(async () => {
  const loaded = await import("../pipeline")
  runMigratePipeline = loaded.runMigratePipeline
})

const tempPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true })
    }),
  )
})

beforeEach(() => {
  resetSpawnSyncMock()
})

function buildRunKey(workspacePath: string, vaultPath: string, model: string, taskIds: string[]): string {
  const hash = createHash("sha1")
  hash.update(workspacePath)
  hash.update(vaultPath)
  hash.update(model)
  hash.update("zettelclaw-migrate-v3")
  hash.update(String(taskIds.length))
  for (const taskId of taskIds) {
    hash.update(taskId)
  }
  return hash.digest("hex")
}

describe("runMigratePipeline", () => {
  it("processes tasks, runs final synthesis, and clears memory directory when all tasks succeed", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-success-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })

    const sourcePath = join(memoryPath, "2026-02-20.md")
    await writeFile(sourcePath, "legacy memory", "utf8")
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-subagent"}', stderr: "" })
      .mockImplementationOnce(() => {
        rmSync(sourcePath, { force: true })
        return {
          status: 0,
          stdout: JSON.stringify({
            entries: [{ action: "finished", status: "ok", summary: '{"summary":"Extracted key items"}', ts: 10 }],
          }),
          stderr: "",
        }
      })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [{ action: "finished", status: "ok", summary: "Final synthesis complete", ts: 20 }],
        }),
        stderr: "",
      })

    const result = await runMigratePipeline({
      workspacePath,
      memoryPath,
      vaultPath,
      notesFolder: "01 Notes",
      journalFolder: "03 Journal",
      model: "claude-sonnet",
      statePath,
      tasks: [
        {
          id: "task-1",
          relativePath: "2026-02-20.md",
          basename: "2026-02-20.md",
          sourcePath,
          kind: "daily",
        },
      ],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(0)
    expect(result.processedTasks).toBe(1)
    expect(result.cleanupPerformed).toBe(true)
    expect(result.finalSynthesisSummary).toBe("Final synthesis complete")

    const remainingMemoryEntries = await readdir(memoryPath)
    expect(remainingMemoryEntries).toEqual([])

    const savedStateRaw = await readFile(statePath, "utf8")
    const savedState = JSON.parse(savedStateRaw) as Record<string, unknown>
    expect(savedState.version).toBe(2)
    expect(savedState.completed).toBeDefined()
  })

  it("keeps partial-success semantics: runs final synthesis and skips cleanup when some tasks fail", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-partial-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })

    const goodSourcePath = join(memoryPath, "good.md")
    const badSourcePath = join(memoryPath, "bad.md")
    await writeFile(goodSourcePath, "good", "utf8")
    await writeFile(badSourcePath, "bad", "utf8")
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-good"}', stderr: "" })
      .mockImplementationOnce(() => {
        rmSync(goodSourcePath, { force: true })
        return {
          status: 0,
          stdout: JSON.stringify({
            entries: [{ action: "finished", status: "ok", summary: '{"summary":"Good migrated"}', ts: 10 }],
          }),
          stderr: "",
        }
      })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-bad"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [{ action: "finished", status: "error", summary: "", error: "tool failed", ts: 20 }],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [{ action: "finished", status: "ok", summary: "Synthesis partial", ts: 30 }],
        }),
        stderr: "",
      })

    const result = await runMigratePipeline({
      workspacePath,
      memoryPath,
      vaultPath,
      notesFolder: "01 Notes",
      journalFolder: "03 Journal",
      model: "claude-sonnet",
      statePath,
      tasks: [
        {
          id: "task-good",
          relativePath: "good.md",
          basename: "good.md",
          sourcePath: goodSourcePath,
          kind: "other",
        },
        {
          id: "task-bad",
          relativePath: "bad.md",
          basename: "bad.md",
          sourcePath: badSourcePath,
          kind: "other",
        },
      ],
      parallelJobs: 1,
    })

    expect(result.processedTasks).toBe(1)
    expect(result.failedTasks).toBe(1)
    expect(result.cleanupPerformed).toBe(false)
    expect(result.finalSynthesisSummary).toBe("Synthesis partial")

    const remainingMemoryEntries = (await readdir(memoryPath)).sort((a, b) => a.localeCompare(b))
    expect(remainingMemoryEntries).toEqual(["bad.md"])
  })

  it("throws when migration produces no successful task results", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-none-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })

    const sourcePath = join(memoryPath, "bad.md")
    await writeFile(sourcePath, "bad", "utf8")

    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"id":"job-bad"}', stderr: "" }).mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({
        entries: [{ action: "finished", status: "error", summary: "", error: "tool failed", ts: 20 }],
      }),
      stderr: "",
    })

    await expect(
      runMigratePipeline({
        workspacePath,
        memoryPath,
        vaultPath,
        notesFolder: "01 Notes",
        journalFolder: "03 Journal",
        model: "claude-sonnet",
        statePath,
        tasks: [
          {
            id: "task-bad",
            relativePath: "bad.md",
            basename: "bad.md",
            sourcePath,
            kind: "other",
          },
        ],
        parallelJobs: 1,
      }),
    ).rejects.toThrow("Migration produced no successful task results")
  })

  it("resumes from state and skips already completed tasks", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-resume-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })

    const existingSourcePath = join(memoryPath, "already.md")
    const pendingSourcePath = join(memoryPath, "pending.md")
    await writeFile(existingSourcePath, "already", "utf8")
    await writeFile(pendingSourcePath, "pending", "utf8")
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    const taskIds = ["task-already", "task-pending"]
    const runKey = buildRunKey(workspacePath, vaultPath, "claude-sonnet", taskIds)
    await mkdir(join(workspacePath, ".zettelclaw"), { recursive: true })
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          version: 2,
          runKey,
          workspacePath,
          vaultPath,
          model: "claude-sonnet",
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
          completed: {
            "task-already": {
              taskId: "task-already",
              relativePath: "already.md",
              extraction: { summary: "already done" },
              completedAt: "2026-02-20T00:00:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-pending"}', stderr: "" })
      .mockImplementationOnce(() => {
        rmSync(pendingSourcePath, { force: true })
        return {
          status: 0,
          stdout: JSON.stringify({
            entries: [{ action: "finished", status: "ok", summary: '{"summary":"Pending migrated"}', ts: 10 }],
          }),
          stderr: "",
        }
      })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [{ action: "finished", status: "ok", summary: "Resumed synthesis", ts: 20 }],
        }),
        stderr: "",
      })

    const result = await runMigratePipeline({
      workspacePath,
      memoryPath,
      vaultPath,
      notesFolder: "01 Notes",
      journalFolder: "03 Journal",
      model: "claude-sonnet",
      statePath,
      tasks: [
        {
          id: "task-already",
          relativePath: "already.md",
          basename: "already.md",
          sourcePath: existingSourcePath,
          kind: "other",
        },
        {
          id: "task-pending",
          relativePath: "pending.md",
          basename: "pending.md",
          sourcePath: pendingSourcePath,
          kind: "other",
        },
      ],
      parallelJobs: 1,
    })

    expect(result.processedTasks).toBe(1)
    expect(result.skippedTasks).toBe(1)
    expect(result.failedTasks).toBe(0)
    expect(result.finalSynthesisSummary).toBe("Resumed synthesis")
  })

  it("fails when final synthesis keeps reporting edit conflicts and writes fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-fallback-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })

    const sourcePath = join(memoryPath, "2026-02-20.md")
    await writeFile(sourcePath, "legacy memory", "utf8")
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    const conflictSummary = "failed: Could not find the exact text to replace"

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-subagent"}', stderr: "" })
      .mockImplementationOnce(() => {
        rmSync(sourcePath, { force: true })
        return {
          status: 0,
          stdout: JSON.stringify({
            entries: [{ action: "finished", status: "ok", summary: '{"summary":"ok"}', ts: 10 }],
          }),
          stderr: "",
        }
      })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis-1"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({ entries: [{ action: "finished", status: "ok", summary: conflictSummary, ts: 20 }] }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis-2"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({ entries: [{ action: "finished", status: "ok", summary: conflictSummary, ts: 30 }] }),
        stderr: "",
      })

    await expect(
      runMigratePipeline({
        workspacePath,
        memoryPath,
        vaultPath,
        notesFolder: "01 Notes",
        journalFolder: "03 Journal",
        model: "claude-sonnet",
        statePath,
        tasks: [
          {
            id: "task-1",
            relativePath: "2026-02-20.md",
            basename: "2026-02-20.md",
            sourcePath,
            kind: "daily",
          },
        ],
        parallelJobs: 1,
      }),
    ).rejects.toThrow("Saved fallback summary")

    const fallbackPath = join(workspacePath, ".zettelclaw", "final-synthesis-fallback.md")
    const fallbackRaw = await readFile(fallbackPath, "utf8")
    expect(fallbackRaw).toContain(conflictSummary)
  })
})
