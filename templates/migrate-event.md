# Zettelclaw Migration

You are migrating OpenClaw workspace memory files into a Zettelclaw vault.

## Vault
Path: {{vaultPath}}

## Files to Migrate
- Workspace: {{workspacePath}}
- Total files: {{fileCount}}
- Daily notes: {{dailyFiles}}
- Other notes: {{otherFiles}}

## Process

### Step 1: Process files in batches of 5

For each batch, spawn sub-agents (one per file) using model `{{model}}`.

Maintain an accumulated **wikilink index** — a list of all note titles that exist in the vault. Start by listing existing notes:
```bash
ls "{{vaultPath}}/01 Notes/"
```

**For daily files** (YYYY-MM-DD.md pattern), instruct each sub-agent:
- Read the memory file at `{{workspacePath}}/memory/<filename>`
- Create a journal entry at `{{vaultPath}}/03 Journal/<filename>` with proper frontmatter (type: journal, tags: [journals], created/updated dates)
- The journal should have sections: Done, Decisions, Open, Notes — summarize the raw content into these sections concisely
- Extract any atomic, reusable ideas into separate notes in `{{vaultPath}}/01 Notes/` with proper frontmatter
- Use `[[wikilinks]]` to link to notes in the provided wikilink index
- Report back: a list of all note titles created (for the wikilink index)
- When complete, delete the original file: `{{workspacePath}}/memory/<filename>`

**For non-daily files**, instruct each sub-agent:
- Read the memory file at `{{workspacePath}}/memory/<filename>`
- Determine the appropriate note type (note, project, research) based on content
- Create a properly typed note in `{{vaultPath}}/01 Notes/` with correct frontmatter and a good Title Case filename
- If the file contains multiple distinct topics, split into multiple atomic notes
- Use `[[wikilinks]]` to link to notes in the provided wikilink index
- Report back: a list of all note titles created
- When complete, delete the original file: `{{workspacePath}}/memory/<filename>`

### Step 2: Wait for each batch to complete

After spawning a batch of up to 5 sub-agents, wait for all to complete before starting the next batch. Collect the reported note titles and add them to the wikilink index for the next batch.

### Step 3: Final pass

After all files are processed:
1. List all notes in `{{vaultPath}}/01 Notes/` to get the complete wikilink index
2. Scan all notes and journals for unresolved `[[wikilinks]]` that could link to existing notes
3. Read `{{workspacePath}}/MEMORY.md`
4. Rewrite MEMORY.md to reference vault notes with `[[wikilinks]]` where relevant
5. Do NOT delete MEMORY.md — it is a critical OpenClaw file

### Rules
- Never create directories — the vault structure already exists
- All tags must be pluralized
- All filenames must be Title Case
- All dates must be YYYY-MM-DD
- Every note must have complete YAML frontmatter
- One idea per note (atomic)
- Link aggressively — first mention of any concept gets a `[[wikilink]]`
- Omit empty journal sections
