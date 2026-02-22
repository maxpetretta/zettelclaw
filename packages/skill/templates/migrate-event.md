# Zettelclaw Migration

You are migrating OpenClaw workspace memory files into a Zettelclaw vault.

## Vault
Path: {{vaultPath}}

## Files to Migrate
- Workspace: {{workspacePath}}
- Total files: {{fileCount}}
- Daily notes: {{dailyCount}}
- Other notes: {{otherCount}}

## Process

### Step 1: Build file lists and process in batches of 5

Recursively list markdown files under `{{workspacePath}}/memory/` (including subdirectories) and split them into two lists using **relative paths from `memory/`**:
- Daily files whose **basename** matches `YYYY-MM-DD.md`
- Non-daily files (everything else)

Then process each list in batches of 5.

For each batch, delegate to subagents (one per file) using model `{{model}}`.

Maintain an accumulated **wikilink index** — a list of all note titles that exist in the vault. Start by listing existing notes:
```bash
ls "{{vaultPath}}/{{notesFolder}}/"
```

**For daily files** (basename matches `YYYY-MM-DD.md`), instruct each sub-agent:
- Read the memory file at `{{workspacePath}}/memory/<relative-path>`
- Use the basename as `<day-filename>` and write/update the journal entry at `{{vaultPath}}/{{journalFolder}}/<day-filename>` with proper frontmatter (type: journal, tags: [journals], created/updated dates)
- The journal should have sections: Done, Decisions, Facts, Open and summarize the raw content into these sections concisely
- For project/research/contact information: prefer updating existing typed notes in `{{vaultPath}}/{{notesFolder}}/` (append-only, preserve structure, update `updated` date). Create a new typed note only when no suitable existing note exists.
- For net-new evergreen ideas: create new evergreen notes in `{{vaultPath}}/{{notesFolder}}/` with proper frontmatter.
- Enforce two-way `[[wikilinks]]` when journal content references typed notes:
  - Journal side: add `[[Note Title]]` links to relevant typed notes.
  - Typed note side: add a reciprocal link back to the source journal day (for example `[[YYYY-MM-DD]]`, derived from `<day-filename>`).
- Report back with exactly two sections:
  - `Summary:` a concise summary of what this sub-agent wrote/updated.
  - `Created Wikilinks:` a deduplicated list of `[[wikilinks]]` newly added by this sub-agent.
- When complete, delete the original file: `{{workspacePath}}/memory/<relative-path>`

**For non-daily files**, instruct each sub-agent:
- Read the memory file at `{{workspacePath}}/memory/<relative-path>`
- Determine the appropriate note type (evergreen, project, research, contact, writing) based on content
- For `project`/`research`/`contact`: prefer updating an existing matching note in `{{vaultPath}}/{{notesFolder}}/` (append-only, update `updated`) instead of creating duplicates
- Create a properly typed note in `{{vaultPath}}/{{notesFolder}}/` with correct frontmatter and a good Title Case filename when no suitable existing note exists
- If the file contains multiple distinct topics, split into multiple evergreen notes
- Use `[[wikilinks]]` to link to notes in the provided wikilink index
- When a non-daily note clearly maps to a migrated journal day, add reciprocal links between the note and that journal entry.
- Report back with exactly two sections:
  - `Summary:` a concise summary of what this sub-agent wrote/updated.
  - `Created Wikilinks:` a deduplicated list of `[[wikilinks]]` newly added by this sub-agent.
- When complete, delete the original file: `{{workspacePath}}/memory/<relative-path>`

### Step 2: Wait for each batch to complete

After spawning a batch of up to 5 sub-agents, wait for all to complete before starting the next batch. Collect each sub-agent's `Created Wikilinks` output and merge those links into the wikilink index for the next batch.

### Step 3: Final pass

After all files are processed:
1. List all notes in `{{vaultPath}}/{{notesFolder}}/` to get the complete wikilink index
2. Validate two-way linking:
   - For each journal link to a typed note, verify the typed note links back to the journal day/session.
   - For each typed note link to a migrated journal day/session, verify the journal links to that typed note where relevant.
3. Scan all notes and journals for unresolved `[[wikilinks]]` that could link to existing notes
4. Read `{{workspacePath}}/MEMORY.md`
5. Rewrite MEMORY.md to reference vault notes with `[[wikilinks]]` where relevant.
   - MEMORY.md must stay a **hot working cache**.
   - Do NOT duplicate stable profile/identity data already captured in `{{workspacePath}}/USER.md` or `{{workspacePath}}/IDENTITY.md`.
   - If needed, keep brief pointers to USER.md / IDENTITY.md instead of repeating that content.
6. Do NOT delete MEMORY.md — it is a critical OpenClaw file.
7. Fully clear `{{workspacePath}}/memory/` after migration:
   - Delete any leftover files recursively.
   - Remove now-empty nested folders.
   - Verify `{{workspacePath}}/memory/` has no remaining files.

### Rules
- Never create directories — the vault structure already exists
- Process `{{workspacePath}}/memory/` recursively (include nested `.md` files)
- All tags must be pluralized
- All filenames must be Title Case
- All dates must be YYYY-MM-DD
- Every note must have complete YAML frontmatter
- Do not insert a blank line between frontmatter and the first content line
- One idea per note (evergreen)
- Migration writes typed notes to `{{vaultPath}}/{{notesFolder}}/` (do not route migrated notes to `00 Inbox/`)
- For existing `project`/`research`/`contact` notes, append instead of overwrite and update frontmatter `updated`
- Link aggressively — first mention of any concept gets a `[[wikilink]]`
- Enforce two-way links between journals and typed notes whenever they reference each other
- Omit empty journal sections
- At migration end, `{{workspacePath}}/memory/` must be empty
- MEMORY.md must not overlap with USER.md or IDENTITY.md content
