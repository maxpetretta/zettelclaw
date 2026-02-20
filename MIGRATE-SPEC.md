# Zettelclaw Migrate Command — Implementation Spec

## Overview

`zettelclaw migrate` converts an existing OpenClaw workspace memory (`~/.openclaw/workspace/memory/*.md`) into a Zettelclaw vault. It backs up the memory directory, presents a model picker for sub-agent cost control, then fires a system event to the running OpenClaw agent with full instructions for orchestrating the migration.

The CLI does NOT do the migration itself. It sets up the preconditions and delegates to the OpenClaw agent, which uses sub-agents for parallel processing.

## Prerequisites

- A Zettelclaw vault must already exist (run `zettelclaw init` first)
- OpenClaw gateway must be running
- The workspace must have `memory/*.md` files to migrate

## CLI Flow

### 1. Detect vault

Look for the vault path. Check (in order):
1. `--vault <path>` flag
2. Auto-detect from OpenClaw config (`agents.defaults.memorySearch.extraPaths`) — find a path that contains `03 Journal/`
3. Prompt the user

If no vault is found, tell the user to run `zettelclaw init` first and exit.

### 2. Detect workspace

Find the OpenClaw workspace (same logic as init):
1. `--workspace <path>` flag  
2. `~/.openclaw/workspace` default

Verify `memory/` directory exists and has `.md` files. If empty, tell the user there's nothing to migrate and exit.

### 3. Show file summary

Display what will be migrated:
```
│  Found 23 memory files to migrate
│  Date range: 2026-01-15 → 2026-02-19
│  Daily notes: 20
│  Other notes: 3
```

Classification logic:
- **Daily notes**: filename matches `YYYY-MM-DD.md` pattern (e.g., `2026-02-19.md`)
- **Other notes**: everything else (e.g., `stt-benchmark.md`, `project-ideas.md`)

### 4. Back up memory directory

Copy `memory/` → `memory.bak/` in the workspace. If `memory.bak/` already exists, use `memory.bak.1/`, `memory.bak.2/`, etc.

Display: `✓ Backed up memory/ → memory.bak/`

### 5. Model picker

Shell out to `openclaw models list --json` to get available models. Parse the JSON response.

Present a clack `select` prompt:
```
◆  Which model should sub-agents use for migration?
│  ○ Claude Opus 4.6 (opus) — default
│  ● Claude Haiku 4.5 (haiku)
│  ○ Kimi K2.5 Free (kimi)
│  ○ Claude Sonnet 4.6 (sonnet)
│  ○ MiniMax M2.5 Free (minimax)
│  ○ GLM-5 (glm)
```

Each option shows: `Display Name (alias)` if alias exists, otherwise `provider/model-id`.

The list should come from the JSON output. Each model has:
```json
{
  "key": "anthropic/claude-haiku-4-5",
  "name": "Claude Haiku 4.5", 
  "tags": ["configured", "alias:haiku"]
}
```

Extract alias from tags: find tag starting with `alias:`, strip prefix.

`--model <alias-or-key>` flag skips the prompt.
`--yes` uses the first non-default model (cheapest option heuristic — prefer models with "free" in the name, otherwise pick haiku/sonnet before opus).

### 6. Fire system event

Use the existing `firePostInitEvent` pattern — shell out to `openclaw system event --text "<instructions>" --mode now`.

The system event text should be a comprehensive instruction to the main agent. Use a template file at `templates/migrate-event.md` with these substitution variables:

- `{{vaultPath}}` — absolute path to the vault
- `{{workspacePath}}` — absolute path to the workspace  
- `{{model}}` — selected model key (e.g., `anthropic/claude-haiku-4-5` or alias)
- `{{fileCount}}` — total number of files
- `{{dailyFiles}}` — JSON array of daily filenames: `["2026-01-15.md", "2026-02-19.md"]`
- `{{otherFiles}}` — JSON array of non-daily filenames: `["stt-benchmark.md", "project-ideas.md"]`

### 7. Exit

Display completion message and exit:
```
◆  Migration started! Your agent will process 23 files and report progress.
```

## Template: `templates/migrate-event.md`

This is the system event sent to the main OpenClaw agent. Write it as a complete instruction document:

```markdown
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
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `--vault <path>` | Vault path (auto-detected if not provided) |
| `--workspace <path>` | OpenClaw workspace path (default: `~/.openclaw/workspace`) |
| `--model <alias-or-key>` | Model for sub-agents (skips prompt) |
| `--yes` | Accept all defaults non-interactively |

## File Structure

Create:
- `src/commands/migrate.ts` — main command implementation
- `templates/migrate-event.md` — system event template

Modify:
- `src/index.ts` — add `migrate` command to parser, help text, and routing

## Implementation Notes

### Model list parsing

```typescript
interface ModelInfo {
  key: string      // e.g., "anthropic/claude-haiku-4-5"
  name: string     // e.g., "Claude Haiku 4.5"
  alias?: string   // e.g., "haiku" (extracted from tags)
}

function parseModels(json: string): ModelInfo[] {
  const data = JSON.parse(json)
  return data.models.map((m: any) => ({
    key: m.key,
    name: m.name,
    alias: m.tags.find((t: string) => t.startsWith("alias:"))?.slice(6),
  }))
}
```

### System event firing

Reuse the pattern from `src/lib/openclaw.ts` `firePostInitEvent`:
- Read template from `templates/migrate-event.md`
- Substitute variables
- Shell out to `openclaw system event --text "<text>" --mode now`

### Template substitution

Simple `{{variable}}` replacement — same as `firePostInitEvent` uses.

### File classification

```typescript
const DAILY_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/

function classifyFiles(files: string[]): { daily: string[]; other: string[] } {
  const daily = files.filter(f => DAILY_PATTERN.test(f))
  const other = files.filter(f => !DAILY_PATTERN.test(f))
  return { daily, other }
}
```

### Backup logic

```typescript
async function backupMemory(workspacePath: string): Promise<string> {
  const src = join(workspacePath, "memory")
  let dest = join(workspacePath, "memory.bak")
  let i = 1
  while (await pathExists(dest)) {
    dest = join(workspacePath, `memory.bak.${i}`)
    i++
  }
  await cp(src, dest, { recursive: true })
  return dest
}
```

## Existing Code Patterns

- Look at `src/commands/init.ts` for the clack prompt pattern (intro, select, spinner, log)
- Look at `src/lib/openclaw.ts` for `firePostInitEvent` and how system events are sent
- Look at `src/lib/paths.ts` for `resolveUserPath` and path helpers
- Use `@clack/prompts` for all interactive prompts
- Follow the existing code style: no semicolons (handled by biome), double quotes, tabs

## Dev Commands

- `bun run lint` — biome check + tsgo type check
- `bun run fix` — biome auto-fix
- `bun run start` — run the CLI (shows help)
- `bun run init` — run init command

## Testing

After implementation, run:
```bash
bun run lint          # must pass clean
bun run start         # verify help text shows migrate
bun run migrate       # should detect no vault / prompt
```
