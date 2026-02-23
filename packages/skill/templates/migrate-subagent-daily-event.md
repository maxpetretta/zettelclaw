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

### Frontmatter (required on every note)
- `type`: one of `journal`, `project`, `research`, `evergreen`, `contact`, `writing`
- `tags`: ALWAYS pluralized (`projects` not `project`, `tools` not `tool`)
- `summary`: one-sentence description
- `created`: `YYYY-MM-DD`
- `updated`: `YYYY-MM-DD`
- Do NOT add `status` except on `project` and `research` notes.

### Atomicity
- **One core idea per note.** The title should capture the idea.
- If the source material covers 5 topics, write 5 small notes — not 1 mega-note.
- A good note can be understood without reading any other note.
- Prefer more small notes over fewer large ones.

### Template Structures (must follow)
- **Journal:** frontmatter with `type: journal`, `tags: [journals]` → `## Done` → `## Decisions` → `## Facts` → `## Open` → `---` → `## Sessions`
- **Project:** frontmatter → `## Goal` → `## Log` (append dated entries)
- **Research:** frontmatter → `## Question` → `## Findings` → `## Conclusion` → `## Sources`
- **Evergreen:** frontmatter only (body is freeform prose)
- **Contact:** frontmatter → `## Context` → `## Notes`
- **Writing:** frontmatter only (body is the writing)

Do NOT invent custom section headers. Use the template sections above.

### Naming
- Filenames are Title Case.
- Project note filenames MUST end with `Project`.
- Research note filenames MUST end with `Research`.

### Content Quality
- High-signal durable knowledge only. No transient details.
- Write conclusions, not transcripts. Summarize what was decided/learned, not the process.
- Use `[[wikilinks]]` where they materially improve navigation.

## Required Actions
1. Read `{{SOURCE_PATH}}`.
2. Create or update `{{VAULT_PATH}}/{{JOURNAL_FOLDER}}/{{FILE_BASENAME}}` using date `{{DAY}}`.
   - Follow the Journal template structure exactly.
   - Do not insert a blank line between frontmatter and first content line.
   - Distill source content into the appropriate sections (`Done`, `Decisions`, `Facts`, `Open`).
   - Use concise bullet points. Link to typed notes with `[[wikilinks]]`.
3. From this file's content, extract durable knowledge into typed notes in `{{VAULT_PATH}}/{{NOTES_FOLDER}}`:
   - Prefer updating existing notes (append-only, preserve structure, update `updated` date).
   - Create new typed notes only when no suitable existing note exists.
   - Follow the template structure for each note type (see above).
   - Update/create at most 2 typed notes for this file. The journal entry is the primary output — typed note updates are secondary.
4. Enforce two-way wikilinks for every journal ↔ typed note relationship:
   - Journal links to typed note(s).
   - Typed note links back to journal day `[[{{DAY}}]]`.
5. Delete the source file `{{SOURCE_PATH}}`.
6. Tool usage constraints:
   - Use exact file paths with spaces as-is (do NOT escape spaces with backslashes).
   - Read/edit files only (do not try to read directories).
   - Keep edits concise and avoid exhaustive rewrites.

## Output Format
Return ONLY valid JSON (no prose, no markdown fences):

{
  "summary": "One concise paragraph of what you changed. Include failures here if any action could not be completed."
}

Contract rules:
- JSON must contain exactly one key: `summary`.
- Never include additional keys.
- Always return valid JSON, even on failure.
