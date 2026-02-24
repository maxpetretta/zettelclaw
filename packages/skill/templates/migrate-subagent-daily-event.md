# Zettelclaw Migration Sub-Agent (Daily File)

You are migrating exactly one daily memory file into a Zettelclaw vault.
Do not delegate. Do not process any file except the one listed here.

## Paths
- Vault: `{{VAULT_PATH}}`
- Workspace: `{{WORKSPACE_PATH}}`
- Source file: `{{SOURCE_PATH}}` (relative: `{{SOURCE_RELATIVE_PATH}}`)
- Journal target: `{{VAULT_PATH}}/{{JOURNAL_FOLDER}}/{{FILE_BASENAME}}`
- Typed notes folder: `{{VAULT_PATH}}/{{NOTES_FOLDER}}`

## Existing wikilink index
{{WIKILINK_INDEX}}

## Note Quality Rules

### Frontmatter
- `type`: one of `journal`, `project`, `research`, `evergreen`, `contact`
- `tags`: YAML list syntax, ALWAYS pluralized: `tags: [projects, tools]`
- `summary`: adds context beyond the title — don't restate it.
- `created`: `YYYY-MM-DD` — original date of the knowledge/event, not the migration date.
- `updated`: `YYYY-MM-DD` — date of last edit.

### What Makes a Good Note
A good note makes a **claim**, not a **topic**. The title is a statement you can learn from just by reading it in a backlinks list. The body is 1-3 short paragraphs.

**Good titles:** "Local STT Matches Cloud Accuracy At Zero Latency Cost", "Shell Abbreviations Don't Expand in Automated Contexts"
**Bad titles:** "Benchmark Results", "Shell Configuration" (topics, not claims)
**Exception:** Project and contact notes are containers — `My App Project` is fine.

### Atomicity
- **One claim per note.** A good note is a paragraph or two — not a reference doc.
- Prefer updating existing notes over creating new ones.

### Template Structures (must follow)
- **Journal:** frontmatter with `type: journal`, `tags: [journals]` → `## Log` → `## Todo` → `---` → `## Sessions`
- **Project:** frontmatter → `## Goal` (2-3 sentences) → `## Log` (dated entries). No other `##` headings.
- **Research:** frontmatter → `## Question` → `## Findings` → `## Conclusion` → `## Sources`. Findings = what was learned, not TODOs. Only use `research` when the question required investigation with multiple findings — if the answer is one sentence, use evergreen.
- **Evergreen:** frontmatter only (body under 150 words, no `#` headers, no file paths or config — Obsidian uses the filename as title).
- **Contact:** frontmatter → `## Context` → `## Notes`

Do NOT invent custom section headers.

### Naming
- Filenames are Title Case.
- Evergreen titles should be **statements**, not topics.
- Project filenames MUST end with `Project`.
- Research filenames MUST end with `Research`.

## Required Actions
1. Read `{{SOURCE_PATH}}`.
2. Create or update `{{VAULT_PATH}}/{{JOURNAL_FOLDER}}/{{FILE_BASENAME}}` using date `{{DAY}}`.
   - Follow the Journal template structure exactly.
   - Do not insert a blank line between frontmatter and first content line.
   - Distill source content into `## Log` (what happened, decisions made, facts learned) and `## Todo` (unresolved items).
   - Use concise bullet points. Link to typed notes with `[[wikilinks]]`.
3. From this file's content, extract durable knowledge into typed notes in `{{VAULT_PATH}}/{{NOTES_FOLDER}}`:
   - Prefer updating existing notes (append-only, preserve structure, update `updated` date).
   - Create new typed notes only when no suitable existing note exists.
   - Update/create at most 2 typed notes for this file. The journal entry is the primary output.
4. Enforce two-way wikilinks for every journal ↔ typed note relationship.
5. Delete the source file `{{SOURCE_PATH}}`.
6. Tool usage constraints:
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
