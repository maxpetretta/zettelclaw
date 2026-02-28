import { describe, expect, it } from "bun:test"
import type { MigrateTask, StoredMigrateTaskResult } from "../contracts"
import { buildMainSynthesisPrompt, buildSubagentPrompt, parseSubagentExtraction } from "../prompt"

function createTask(overrides: Partial<MigrateTask> = {}): MigrateTask {
  return {
    id: "task-1",
    relativePath: "2026-02-20.md",
    basename: "2026-02-20.md",
    sourcePath: "/workspace/memory/2026-02-20.md",
    kind: "daily",
    ...overrides,
  }
}

function createResult(relativePath: string, summary: string): StoredMigrateTaskResult {
  return {
    taskId: `task-${relativePath}`,
    relativePath,
    completedAt: "2026-02-20T00:00:00.000Z",
    extraction: {
      summary,
    },
  }
}

describe("prompt builders", () => {
  it("builds daily subagent prompts with resolved placeholders and deduped wikilinks", async () => {
    const task = createTask()

    const prompt = await buildSubagentPrompt({
      task,
      workspacePath: "/workspace",
      vaultPath: "/vault",
      notesFolder: "01 Notes",
      journalFolder: "03 Journal",
      wikilinkTitles: ["Alpha", " alpha ", "Beta"],
    })

    expect(prompt).toContain("/vault")
    expect(prompt).toContain("/workspace/memory/2026-02-20.md")
    expect(prompt).toContain("2026-02-20")
    expect(prompt).toContain("- [[Alpha]]")
    expect(prompt).toContain("- [[Beta]]")

    const prompt2 = await buildSubagentPrompt({
      task,
      workspacePath: "/workspace",
      vaultPath: "/vault",
      notesFolder: "01 Notes",
      journalFolder: "03 Journal",
      wikilinkTitles: [],
    })

    expect(prompt2).toContain("- n/a")
  })

  it("caps subagent wikilink index and prioritizes task-related titles", async () => {
    const task = createTask({
      relativePath: "projects/bracky-codebase.md",
      basename: "bracky-codebase.md",
      sourcePath: "/workspace/memory/projects/bracky-codebase.md",
      kind: "other",
    })

    const titles = [
      "Bracky Project",
      "Bracky Research",
      ...Array.from({ length: 80 }, (_, index) => `Topic ${String(index).padStart(2, "0")}`),
    ]

    const prompt = await buildSubagentPrompt({
      task,
      workspacePath: "/workspace",
      vaultPath: "/vault",
      notesFolder: "01 Notes",
      journalFolder: "03 Journal",
      wikilinkTitles: titles,
    })

    const wikilinkLines = prompt.split("\n").filter((line) => line.startsWith("- [["))
    expect(wikilinkLines.length).toBeLessThanOrEqual(41)
    expect(prompt).toContain("- [[Bracky Project]]")
    expect(prompt).toContain("- [[Bracky Research]]")
  })

  it("builds main synthesis prompts and truncates oversized summaries", async () => {
    const hugeSummary = "A".repeat(20_000)
    const results = [
      createResult("z.md", hugeSummary),
      createResult("a.md", hugeSummary),
      createResult("m.md", hugeSummary),
      createResult("b.md", hugeSummary),
    ]

    const prompt = await buildMainSynthesisPrompt({
      workspacePath: "/workspace",
      vaultPath: "/vault",
      notesFolder: "01 Notes",
      journalFolder: "03 Journal",
      model: "claude-sonnet",
      completedResults: results,
    })

    expect(prompt).toContain("claude-sonnet")
    expect(prompt).toContain("a.md")
    expect(prompt).toContain("truncated after")
  })
})

describe("parseSubagentExtraction", () => {
  it("parses strict JSON output", () => {
    const parsed = parseSubagentExtraction('{"summary":"  Added   useful  notes "}', createTask())
    expect(parsed).toEqual({ summary: "Added useful notes" })
  })

  it("parses fenced strict JSON output", () => {
    const parsed = parseSubagentExtraction(
      ["analysis", "```json", '{"summary":"Captured decisions"}', "```"].join("\n"),
      createTask(),
    )
    expect(parsed).toEqual({ summary: "Captured decisions" })
  })

  it("rejects JSON with extra keys", () => {
    expect(() => parseSubagentExtraction('{"summary":"ok","status":"ok"}', createTask())).toThrow(
      "Could not parse strict migration sub-agent output",
    )
  })

  it("rejects non-JSON output", () => {
    expect(() => parseSubagentExtraction("plain text", createTask())).toThrow(
      "Could not parse strict migration sub-agent output",
    )
  })

  it("rejects empty summary", () => {
    expect(() => parseSubagentExtraction('{"summary":"   "}', createTask())).toThrow(
      "Could not parse strict migration sub-agent output",
    )
  })
})
