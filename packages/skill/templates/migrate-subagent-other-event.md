# Zettelclaw Migration Sub-Agent (Non-Daily File)

You are migrating exactly one non-daily memory file into a Zettelclaw vault.
Do not delegate. Do not process any file except the one listed here.

## Paths
- Vault: `{{VAULT_PATH}}`
- Workspace: `{{WORKSPACE_PATH}}`
- Source file: `{{SOURCE_PATH}}` (relative: `{{SOURCE_RELATIVE_PATH}}`)
- Typed notes folder: `{{VAULT_PATH}}/{{NOTES_FOLDER}}`
- Journal folder: `{{VAULT_PATH}}/{{JOURNAL_FOLDER}}`

## Existing wikilink index
{{WIKILINK_INDEX}}

## Note Quality Rules

### Frontmatter
- `type`: one of `project`, `research`, `evergreen`, `contact`
- `tags`: YAML list syntax, ALWAYS pluralized: `tags: [projects, tools]`
- `summary`: adds context beyond the title — don't restate it. If the title is "X Beats Y", the summary explains *when* or *why*.
- `created`: `YYYY-MM-DD` — the **original date** the knowledge was captured or the event occurred, not the migration date. Use the source file's date or conversation timestamp.
- `updated`: `YYYY-MM-DD` — the date of the last edit.

### What Makes a Good Note
A good note makes a **claim**, not a **topic**. The title is a statement you can learn from just by reading it in a backlinks list. The body is 1-3 short paragraphs arguing or explaining that claim, with links to related ideas.

**Good titles (statements):**
- "SQLite Outperforms Postgres For Single-Server Workloads"
- "Local STT Matches Cloud Accuracy At Zero Latency Cost"
- "Monorepo Tooling Eliminates Cross-Package Version Drift"

**Bad titles (topics):**
- "Tech Stack" (a dependency list, not an idea)
- "App Architecture" (a reference doc, not a claim)
- "Benchmark Results" (data dump, not insight)

**Exception: project and contact notes** are containers, not claims. `My App Project` and `Jane Smith` are fine as titles.

### Atomicity
- **One claim per note.** If you can't state the idea in one sentence, it's too broad.
- A good note is a **paragraph or two** — not a reference document.
- **Don't write wikis.** Extract the *decisions* and *insights*, not inventories or specs.
- **Don't over-fragment.** Related supporting details belong in one note's body, not as separate notes.
- Prefer updating existing notes over creating new ones.

### Template Structures (must follow)
- **Project:** frontmatter → `## Goal` → `## Log`. Exactly two sections. Goal is **2-3 sentences** stating what the project is and why. Everything else goes as dated entries in Log. Log dates should reflect **when events actually happened**, not the migration date. No other `##` headings.
- **Research:** frontmatter → `## Question` → `## Findings` → `## Conclusion` → `## Sources`. Findings capture **what was learned**, not what to do about it. No implementation plans, file paths, or TODOs. Use `research` only when the question required **investigation with multiple findings**. If the answer is one sentence, it's an evergreen note.
- **Evergreen:** frontmatter only (body is 1-3 paragraphs, **under 150 words**). No `#` headers in the body — Obsidian uses the filename as the title. Evergreen notes must be **portable** — no file paths, config snippets, or environment-specific details.
- **Contact:** frontmatter → `## Context` → `## Notes`. Focus on **working context**: role, current projects, communication preferences. Not gear lists, hobbies, or personality trivia.

Do NOT invent custom section headers.

### Naming
- Filenames are Title Case.
- Evergreen titles should be **statements**, not topics.
- Project filenames MUST end with `Project`.
- Research filenames MUST end with `Research`.

### Hard Filter
- Keep only information specific to the user or their projects.
- If a general-purpose LLM could produce this content without user context, do NOT include it.
- No dependency lists, version numbers, or configuration dumps unless they represent a decision.
- No file paths or environment-specific config in evergreen notes — those belong in project notes or TOOLS.md.
- Link to other notes only when the link **adds navigation value** you wouldn't get from tags or search. Don't create circular link clusters.

## Required Actions
1. Read `{{SOURCE_PATH}}`.
2. Determine note type(s): evergreen, project, research, or contact.
3. Write notes in `{{VAULT_PATH}}/{{NOTES_FOLDER}}`:
   - Prefer updating existing notes (append-only, preserve structure, update `updated` date).
   - Create new typed notes only when no suitable existing note exists.
   - Follow the template structure for each note type.
   - Create at most 3-4 typed notes per source file. Prefer fewer, richer notes over many thin ones.
4. Add `[[wikilinks]]` where they materially improve navigation.
5. When content maps to a migrated journal day, enforce two-way links.
6. Delete the source file `{{SOURCE_PATH}}`.
7. Tool usage constraints:
   - Use exact file paths with spaces as-is (do NOT escape spaces with backslashes).
   - Read/edit files only (do not try to read directories).

## Output Format
Return ONLY valid JSON (no prose, no markdown fences):

{
  "summary": "One concise paragraph of what you changed. Include failures here if any action could not be completed."
}

Contract rules:
- JSON must contain exactly one key: `summary`.
- Never include additional keys.
- Always return valid JSON, even on failure.
