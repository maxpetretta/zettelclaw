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

List markdown files in `{{workspacePath}}/memory/` and split them into two lists:
- Daily files matching `YYYY-MM-DD.md`
- Non-daily files

Then process each list in batches of 5.

For each batch, delegate to subagents (one per file) using model `{{model}}`.

Maintain an accumulated **wikilink index** — a list of all note titles that exist in the vault. Start by listing existing notes:
```bash
ls "{{vaultPath}}/{{notesFolder}}/"
```

**For daily files** (YYYY-MM-DD.md pattern), instruct each sub-agent:
- Read the memory file at `{{workspacePath}}/memory/<filename>`
- Create a journal entry at `{{vaultPath}}/{{journalFolder}}/<filename>` with proper frontmatter (type: journal, tags: [journals], created/updated dates)
- The journal should have sections: Done, Decisions, Facts, Open and summarize the raw content into these sections concisely
- For project/research/contact information: prefer updating existing typed notes in `{{vaultPath}}/{{notesFolder}}/` (append-only, preserve structure, update `updated` date). Create a new typed note only when no suitable existing note exists.
- For net-new evergreen ideas: create new evergreen notes in `{{vaultPath}}/{{notesFolder}}/` with proper frontmatter.
- Enforce two-way `[[wikilinks]]` when journal content references typed notes:
  - Journal side: add `[[Note Title]]` links to relevant typed notes.
  - Typed note side: add a reciprocal link back to the source journal day (for example `[[YYYY-MM-DD]]`, derived from `<filename>`).
- Report back with exactly two sections:
  - `Summary:` a concise summary of what this sub-agent wrote/updated.
  - `Created Wikilinks:` a deduplicated list of `[[wikilinks]]` newly added by this sub-agent.
- When complete, delete the original file: `{{workspacePath}}/memory/<filename>`

**For non-daily files**, instruct each sub-agent:
- Read the memory file at `{{workspacePath}}/memory/<filename>`
- Determine the appropriate note type (evergreen, project, research, contact, writing) based on content
- For `project`/`research`/`contact`: prefer updating an existing matching note in `{{vaultPath}}/{{notesFolder}}/` (append-only, update `updated`) instead of creating duplicates
- Create a properly typed note in `{{vaultPath}}/{{notesFolder}}/` with correct frontmatter and a good Title Case filename when no suitable existing note exists
- If the file contains multiple distinct topics, split into multiple evergreen notes
- Use `[[wikilinks]]` to link to notes in the provided wikilink index
- When a non-daily note clearly maps to a migrated journal day, add reciprocal links between the note and that journal entry.
- Report back with exactly two sections:
  - `Summary:` a concise summary of what this sub-agent wrote/updated.
  - `Created Wikilinks:` a deduplicated list of `[[wikilinks]]` newly added by this sub-agent.
- When complete, delete the original file: `{{workspacePath}}/memory/<filename>`

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
5. Rewrite MEMORY.md to reference vault notes with `[[wikilinks]]` where relevant
6. Do NOT delete MEMORY.md — it is a critical OpenClaw file

### Rules
- Never create directories — the vault structure already exists
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
