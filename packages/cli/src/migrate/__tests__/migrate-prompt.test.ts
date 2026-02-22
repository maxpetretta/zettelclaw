import { describe, expect, it } from "bun:test"
import type { MigrateTask, StoredMigrateTaskResult } from "../contracts"
import {
  buildMainSynthesisPrompt,
  buildSubagentPrompt,
  normalizeWikilinkToken,
  parseSubagentExtraction,
  wikilinkTitleFromToken,
} from "../prompt"

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
      sourceFile: relativePath,
      status: "ok",
      summary,
      createdWikilinks: ["[[Alpha]]"],
      createdNotes: ["01 Notes/Alpha.md"],
      updatedNotes: [],
      journalDaysTouched: ["2026-02-20"],
      deletedSource: true,
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

    // Hit cached template branch in loadTemplate.
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
  it("parses fenced JSON output", () => {
    const summary = [
      "analysis",
      "```json",
      JSON.stringify({
        source_file: "2026-02-20.md",
        status: "ok",
        summary: "  Added   useful  notes ",
        created_wikilinks: ["[[Alpha]]", "[[alpha]]", "[[Beta|Alias]]"],
        created_notes: ["01 Notes\\Alpha.md", "01 Notes\\Alpha.md"],
        updated_notes: "01 Notes/Beta.md,01 Notes/Beta.md",
        journal_days_touched: ["2026-02-20", "invalid"],
        deleted_source: true,
      }),
      "```",
    ].join("\n")

    const parsed = parseSubagentExtraction(summary, createTask())

    expect(parsed.sourceFile).toBe("2026-02-20.md")
    expect(parsed.status).toBe("ok")
    expect(parsed.summary).toBe("Added useful notes")
    expect(parsed.createdWikilinks).toEqual(["[[Alpha]]", "[[Beta]]"])
    expect(parsed.createdNotes).toEqual(["01 Notes/Alpha.md"])
    expect(parsed.updatedNotes).toEqual(["01 Notes/Beta.md"])
    expect(parsed.journalDaysTouched).toEqual(["2026-02-20"])
    expect(parsed.deletedSource).toBe(true)
  })

  it("parses section-style output when JSON is unavailable", () => {
    const summary = [
      "Summary: Captured key decisions",
      "Created Wikilinks: [[Alpha]], [[Beta]]",
      "- [[Gamma]]",
      "[[Delta]]",
    ].join("\n")

    const parsed = parseSubagentExtraction(summary, createTask({ relativePath: "other.md" }))

    expect(parsed.sourceFile).toBe("other.md")
    expect(parsed.summary).toBe("Captured key decisions")
    expect(parsed.createdWikilinks).toEqual(["[[Alpha]]", "[[Beta]]", "[[Gamma]]", "[[Delta]]"])
  })

  it("falls back to normalized plain text output", () => {
    const parsed = parseSubagentExtraction("  some   plain\n text  ", createTask({ relativePath: "x.md" }))

    expect(parsed.sourceFile).toBe("x.md")
    expect(parsed.summary).toBe("some plain text")
    expect(parsed.createdWikilinks).toEqual([])
    expect(parsed.deletedSource).toBe(false)
  })

  it("falls back to normalized raw candidate when JSON object is empty", () => {
    const parsed = parseSubagentExtraction("{}", createTask({ relativePath: "empty-object.md" }))
    expect(parsed.sourceFile).toBe("empty-object.md")
    expect(parsed.summary).toBe("{}")
  })

  it("handles minimal JSON objects with missing string fields", () => {
    const parsed = parseSubagentExtraction('{"foo":"bar"}', createTask({ relativePath: "minimal.md" }))
    expect(parsed.sourceFile).toBe("minimal.md")
    expect(parsed.summary).toBe("")
    expect(parsed.createdWikilinks).toEqual([])
    expect(parsed.createdNotes).toEqual([])
    expect(parsed.updatedNotes).toEqual([])
  })

  it("stops parsing created wikilinks when the section ends", () => {
    const summary = ["Summary: done", "Created Wikilinks:", "- [[Alpha]]", "Not a link anymore"].join("\n")
    const parsed = parseSubagentExtraction(summary, createTask({ relativePath: "section.md" }))
    expect(parsed.createdWikilinks).toEqual(["[[Alpha]]"])
  })

  it("throws when extraction output is empty", () => {
    expect(() => parseSubagentExtraction("  \n  ", createTask({ relativePath: "empty.md" }))).toThrow(
      "Could not parse migration sub-agent output for empty.md",
    )
  })
})

describe("wikilink normalization", () => {
  it("extracts wikilink titles from different token formats", () => {
    expect(wikilinkTitleFromToken("[[Folder/Alpha.md|Alias]]")).toBe("Alpha")
    expect(wikilinkTitleFromToken("[[Beta#Heading]]")).toBe("Beta")
    expect(wikilinkTitleFromToken("Gamma.md")).toBe("Gamma")
    expect(wikilinkTitleFromToken("   ")).toBeUndefined()

    expect(normalizeWikilinkToken("Folder/Delta.md")).toBe("[[Delta]]")
    expect(normalizeWikilinkToken("   ")).toBeUndefined()
  })
})
