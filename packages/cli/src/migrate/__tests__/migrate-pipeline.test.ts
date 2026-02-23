import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
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

function buildRunKey(workspacePath: string, vaultPath: string, model: string): string {
  const hash = createHash("sha1")
  hash.update(workspacePath)
  hash.update(vaultPath)
  hash.update(model)
  hash.update("zettelclaw-migrate-v2")
  return hash.digest("hex")
}

describe("runMigratePipeline", () => {
  it("processes tasks, runs final synthesis, and clears memory directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-test-"))
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

    const extractionPayload = JSON.stringify({
      sourceFile: "2026-02-20.md",
      status: "ok",
      summary: "Extracted key items",
      createdWikilinks: ["[[Atomic Note]]"],
      createdNotes: ["01 Notes/Atomic Note.md"],
      updatedNotes: ["01 Notes/Existing.md"],
      journalDaysTouched: ["2026-02-20"],
      deletedSource: true,
    })

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-subagent"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [
            {
              action: "finished",
              status: "ok",
              summary: extractionPayload,
              ts: 10,
            },
          ],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [
            {
              action: "finished",
              status: "ok",
              summary: "Final synthesis complete",
              ts: 20,
            },
          ],
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
      parallelJobs: 0,
    })

    expect(result.failedTasks).toBe(0)
    expect(result.processedTasks).toBe(1)
    expect(result.finalSynthesisSummary).toBe("Final synthesis complete")
    expect(result.cleanupCompleted).toBe(true)
    expect(result.completedResults).toHaveLength(1)

    expect(spawnSyncMock).toHaveBeenCalledTimes(4)

    const remainingMemoryEntries = await readdir(memoryPath)
    expect(remainingMemoryEntries).toEqual([])

    const savedStateRaw = await readFile(statePath, "utf8")
    const savedState = JSON.parse(savedStateRaw) as Record<string, unknown>

    expect(savedState.finalSynthesisCompleted).toBe(true)
    expect(savedState.cleanupCompleted).toBe(true)
  })

  it("returns failed tasks and skips cleanup when sub-agent extraction reports error status", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-fail-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })

    const sourcePath = join(memoryPath, "bad.md")
    await writeFile(sourcePath, "legacy memory", "utf8")

    const extractionPayload = JSON.stringify({
      sourceFile: "bad.md",
      status: "error",
      summary: "Sub-agent failed",
      createdWikilinks: [],
      createdNotes: [],
      updatedNotes: [],
      journalDaysTouched: [],
      deletedSource: false,
    })

    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"id":"job-subagent"}', stderr: "" }).mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({
        entries: [{ action: "finished", status: "ok", summary: extractionPayload, ts: 10 }],
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
          id: "task-bad",
          relativePath: "bad.md",
          basename: "bad.md",
          sourcePath,
          kind: "other",
        },
      ],
      parallelJobs: Number.NaN,
    })

    expect(result.failedTasks).toBe(1)
    expect(result.cleanupCompleted).toBe(false)
    expect(result.finalSynthesisSummary).toBe("")

    const remainingMemoryEntries = await readdir(memoryPath)
    expect(remainingMemoryEntries).toEqual(["bad.md"])
  })

  it("parses existing state and continues from completed results for synthesis", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-resume-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")
    const model = "claude-sonnet"
    const runKey = buildRunKey(workspacePath, vaultPath, model)

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    const existingState = {
      version: 1,
      runKey,
      workspacePath,
      vaultPath,
      model,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
      completed: {
        "task-1": {
          taskId: "task-1",
          relativePath: "2026-02-20.md",
          completedAt: "2026-02-20T00:00:00.000Z",
          extraction: {
            sourceFile: "2026-02-20.md",
            status: "ok",
            summary: "Pre-completed summary",
            createdWikilinks: ["[[Alpha]]"],
            createdNotes: ["01 Notes/Alpha.md"],
            updatedNotes: [],
            journalDaysTouched: ["2026-02-20"],
            deletedSource: true,
          },
        },
      },
      finalSynthesisCompleted: false,
      cleanupCompleted: false,
    }

    await mkdir(join(workspacePath, ".zettelclaw"), { recursive: true })
    await writeFile(statePath, `${JSON.stringify(existingState, null, 2)}\n`, "utf8")

    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis"}', stderr: "" }).mockReturnValueOnce({
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
      model,
      statePath,
      tasks: [],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(0)
    expect(result.processedTasks).toBe(0)
    expect(result.completedResults).toHaveLength(1)
    expect(result.finalSynthesisSummary).toBe("Resumed synthesis")
    expect(result.cleanupCompleted).toBe(true)
  })

  it("resets completed state when a previous run was fully cleaned up", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-reset-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")
    const model = "claude-sonnet"
    const runKey = buildRunKey(workspacePath, vaultPath, model)

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    const sourcePath = join(memoryPath, "new.md")
    await writeFile(sourcePath, "new content", "utf8")

    await mkdir(join(workspacePath, ".zettelclaw"), { recursive: true })
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          version: 1,
          runKey,
          workspacePath,
          vaultPath,
          model,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
          completed: {
            "old-task": {
              taskId: "old-task",
              relativePath: "old.md",
              completedAt: "2026-02-20T00:00:00.000Z",
              extraction: {
                sourceFile: "old.md",
                status: "ok",
                summary: "old summary",
                createdWikilinks: ["[[Old]]"],
                createdNotes: ["01 Notes/Old.md"],
                updatedNotes: [],
                journalDaysTouched: [],
                deletedSource: true,
              },
            },
          },
          finalSynthesisCompleted: true,
          finalSynthesisSummary: "already done",
          cleanupCompleted: true,
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const extractionPayload = JSON.stringify({
      sourceFile: "new.md",
      status: "ok",
      summary: "new summary",
      createdWikilinks: ["[[New]]"],
      createdNotes: ["01 Notes/New.md"],
      updatedNotes: [],
      journalDaysTouched: [],
      deletedSource: true,
    })

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-subagent"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({ entries: [{ action: "finished", status: "ok", summary: extractionPayload, ts: 10 }] }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [{ action: "finished", status: "ok", summary: "Synthesis after reset", ts: 20 }],
        }),
        stderr: "",
      })

    const result = await runMigratePipeline({
      workspacePath,
      memoryPath,
      vaultPath,
      notesFolder: "01 Notes",
      journalFolder: "03 Journal",
      model,
      statePath,
      tasks: [
        {
          id: "task-new",
          relativePath: "new.md",
          basename: "new.md",
          sourcePath,
          kind: "other",
        },
      ],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(0)
    expect(result.completedResults).toHaveLength(1)
    expect(result.completedResults[0]?.relativePath).toBe("new.md")
  })

  it("flags successful extraction when source file was not deleted", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-nodelete-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    const sourcePath = join(memoryPath, "nodelete.md")
    await writeFile(sourcePath, "legacy memory", "utf8")

    const extractionPayload = JSON.stringify({
      sourceFile: "nodelete.md",
      status: "ok",
      summary: "summary",
      createdWikilinks: [],
      createdNotes: [],
      updatedNotes: [],
      journalDaysTouched: [],
      deletedSource: false,
    })

    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"id":"job-subagent"}', stderr: "" }).mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({ entries: [{ action: "finished", status: "ok", summary: extractionPayload, ts: 10 }] }),
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
          id: "task-nodelete",
          relativePath: "nodelete.md",
          basename: "nodelete.md",
          sourcePath,
          kind: "other",
        },
      ],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(1)
    expect(result.failedTaskErrors[0]).toContain("Source file was not deleted")
  })

  it("throws when final synthesis does not produce MEMORY.md and USER.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-missing-final-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })

    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis"}', stderr: "" }).mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({
        entries: [{ action: "finished", status: "ok", summary: "Synthesis complete", ts: 10 }],
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
        tasks: [],
        parallelJobs: 1,
      }),
    ).rejects.toThrow("Final synthesis did not produce required file updates")
  })

  it("retries final synthesis when summary reports edit conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-synthesis-retry-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    const failedSummary =
      "⚠️ 📝 Edit failed: Could not find the exact text in /tmp/workspace/USER.md while applying update."

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis-1"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [{ action: "finished", status: "ok", summary: failedSummary, ts: 10 }],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis-2"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [{ action: "finished", status: "ok", summary: "Recovered synthesis", ts: 20 }],
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
      tasks: [],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(0)
    expect(result.finalSynthesisSummary).toBe("Recovered synthesis")
    expect(spawnSyncMock).toHaveBeenCalledTimes(4)
  })

  it("writes fallback synthesis output and fails when edit conflicts persist", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-synthesis-fallback-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    const failedSummary =
      "⚠️ 📝 Edit failed: Could not find the exact text in /tmp/workspace/USER.md while applying update."

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis-1"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [{ action: "finished", status: "ok", summary: failedSummary, ts: 10 }],
        }),
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis-2"}', stderr: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          entries: [{ action: "finished", status: "ok", summary: failedSummary, ts: 20 }],
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
        tasks: [],
        parallelJobs: 1,
      }),
    ).rejects.toThrow("Final synthesis reported unresolved edit conflicts")

    const fallbackPath = join(workspacePath, ".zettelclaw", "final-synthesis-fallback.md")
    const fallbackContents = await readFile(fallbackPath, "utf8")
    expect(fallbackContents).toContain("Could not find the exact text")
  })

  it("captures parse failures from malformed sub-agent output", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-parse-fail-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    const sourcePath = join(memoryPath, "parsefail.md")
    await writeFile(sourcePath, "legacy memory", "utf8")

    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"id":"job-subagent"}', stderr: "" }).mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({
        entries: [{ action: "finished", status: "ok", summary: " \n ", ts: 10 }],
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
          id: "task-parsefail",
          relativePath: "parsefail.md",
          basename: "parsefail.md",
          sourcePath,
          kind: "other",
        },
      ],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(1)
    expect(result.failedTaskErrors[0]).toContain("Could not parse migration sub-agent output")
  })

  it("propagates detailed OpenClaw job failures from cron runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-job-fail-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    const sourcePath = join(memoryPath, "jobfail.md")
    await writeFile(sourcePath, "legacy memory", "utf8")

    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"id":"job-subagent"}', stderr: "" }).mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({
        entries: [
          {
            action: "finished",
            status: "error",
            error: "sub-agent crashed",
            summary: "",
            ts: 10,
          },
        ],
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
          id: "task-jobfail",
          relativePath: "jobfail.md",
          basename: "jobfail.md",
          sourcePath,
          kind: "other",
        },
      ],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(1)
    expect(result.failedTaskErrors[0]).toContain("sub-agent crashed")
  })

  it("handles missing notes directories and invalid completed state shapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-invalid-state-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")
    const model = "claude-sonnet"
    const runKey = buildRunKey(workspacePath, vaultPath, model)

    await mkdir(memoryPath, { recursive: true })
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    await mkdir(join(workspacePath, ".zettelclaw"), { recursive: true })
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          version: 1,
          runKey,
          workspacePath,
          vaultPath,
          model,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
          completed: [],
          finalSynthesisCompleted: false,
          cleanupCompleted: false,
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis"}', stderr: "" }).mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({
        entries: [{ action: "finished", status: "ok", summary: "Synth ok", ts: 10 }],
      }),
      stderr: "",
    })

    const result = await runMigratePipeline({
      workspacePath,
      memoryPath,
      vaultPath,
      notesFolder: "01 Notes",
      journalFolder: "03 Journal",
      model,
      statePath,
      tasks: [],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(0)
    expect(result.cleanupCompleted).toBe(true)
  })

  it("ignores malformed completed entries when resuming state", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-malformed-completed-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")
    const model = "claude-sonnet"
    const runKey = buildRunKey(workspacePath, vaultPath, model)

    await mkdir(memoryPath, { recursive: true })
    await mkdir(join(notesPath, "sub"), { recursive: true })
    await writeFile(join(notesPath, "keep.md"), "note", "utf8")
    await writeFile(join(notesPath, "skip.txt"), "ignore", "utf8")
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")

    await mkdir(join(workspacePath, ".zettelclaw"), { recursive: true })
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          version: 1,
          runKey,
          workspacePath,
          vaultPath,
          model,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
          completed: {
            bad1: [],
            bad2: { taskId: "x", relativePath: "x.md", completedAt: "2026-02-20T00:00:00.000Z", extraction: {} },
          },
          finalSynthesisCompleted: true,
          finalSynthesisSummary: "done",
          cleanupCompleted: true,
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const result = await runMigratePipeline({
      workspacePath,
      memoryPath,
      vaultPath,
      notesFolder: "01 Notes",
      journalFolder: "03 Journal",
      model,
      statePath,
      tasks: [],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(0)
    expect(result.completedResults).toEqual([])
    expect(result.finalSynthesisSummary).toBe("done")
  })

  it("recovers when state file contains a non-object root", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-state-array-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")
    await mkdir(join(workspacePath, ".zettelclaw"), { recursive: true })
    await writeFile(statePath, "[]\n", "utf8")

    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis"}', stderr: "" }).mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({
        entries: [{ action: "finished", status: "ok", summary: "Synth from array state", ts: 10 }],
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
      tasks: [],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(0)
    expect(result.finalSynthesisSummary).toBe("Synth from array state")
  })

  it("recovers when state version is unsupported", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-state-version-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")
    await mkdir(join(workspacePath, ".zettelclaw"), { recursive: true })
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          version: 2,
          runKey: "invalid",
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis"}', stderr: "" }).mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({
        entries: [{ action: "finished", status: "ok", summary: "Synth from version mismatch", ts: 10 }],
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
      tasks: [],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(0)
    expect(result.finalSynthesisSummary).toBe("Synth from version mismatch")
  })

  it("recovers when state has invalid scalar fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-state-scalars-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })
    await writeFile(join(workspacePath, "MEMORY.md"), "memory baseline", "utf8")
    await writeFile(join(workspacePath, "USER.md"), "user baseline", "utf8")
    await mkdir(join(workspacePath, ".zettelclaw"), { recursive: true })
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          version: 1,
          runKey: "rk",
          workspacePath,
          vaultPath,
          model: "claude-sonnet",
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
          completed: {},
          finalSynthesisCompleted: "no",
          cleanupCompleted: "no",
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: '{"id":"job-synthesis"}', stderr: "" }).mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({
        entries: [{ action: "finished", status: "ok", summary: "Synth from scalar mismatch", ts: 10 }],
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
      tasks: [],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(0)
    expect(result.finalSynthesisSummary).toBe("Synth from scalar mismatch")
  })

  it("drops completed entries that are missing required stored-result fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-migrate-pipeline-state-stored-entry-"))
    tempPaths.push(root)

    const workspacePath = join(root, "workspace")
    const memoryPath = join(workspacePath, "memory")
    const vaultPath = join(root, "vault")
    const notesPath = join(vaultPath, "01 Notes")
    const statePath = join(workspacePath, ".zettelclaw", "migrate-state.json")
    const model = "claude-sonnet"
    const runKey = buildRunKey(workspacePath, vaultPath, model)

    await mkdir(memoryPath, { recursive: true })
    await mkdir(notesPath, { recursive: true })
    await mkdir(join(workspacePath, ".zettelclaw"), { recursive: true })
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          version: 1,
          runKey,
          workspacePath,
          vaultPath,
          model,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
          completed: {
            bad: {
              taskId: "bad",
              relativePath: "bad.md",
              extraction: {
                sourceFile: "bad.md",
                summary: "summary",
                deletedSource: true,
              },
            },
          },
          finalSynthesisCompleted: true,
          finalSynthesisSummary: "already done",
          cleanupCompleted: true,
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const result = await runMigratePipeline({
      workspacePath,
      memoryPath,
      vaultPath,
      notesFolder: "01 Notes",
      journalFolder: "03 Journal",
      model,
      statePath,
      tasks: [],
      parallelJobs: 1,
    })

    expect(result.failedTasks).toBe(0)
    expect(result.completedResults).toEqual([])
  })
})
