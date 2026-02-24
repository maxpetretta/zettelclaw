## Memory

You wake up fresh each session. Your knowledge lives in two places:

- **Vault:** Your Zettelclaw Obsidian vault at `{{VAULT_PATH}}` — the single source of truth for all durable knowledge. Notes, projects, research, contacts, and daily journals all live here.
- **MEMORY.md:** Your hot cache — a curated summary of the most important vault content, loaded every main session. Think of it as your working memory.

The vault is indexed via `memory_search` alongside the workspace, so semantic search covers everything.

### How Memory Works

- **Layer 1 - Hook -> Journal (automatic on `/new` or `/reset`):** The hook appends bullets to `## Log` and `## Todo` in `03 Journal/YYYY-MM-DD.md`, then records provenance in `## Sessions` as `SESSION_ID — HH:MM`. Journal-only raw capture: no wikilinks, no note creation.
- **Layer 2 - Agent + Human -> Notes (during sessions):** When meaningful work happens with the human, update the relevant project/research notes directly in `01 Notes/`.
- **Layer 3 - Nightly Cron -> Maintenance (agent-only):** A dedicated isolated cron session runs nightly to review the past day of journals, update existing notes in `01 Notes/`, and put net-new concepts in `00 Inbox/` for human review.

### When to Update the Vault Directly

If the human is present, update typed notes in `01 Notes/` during the session when work is meaningful:

- Completed a task on an active project → append a dated log entry
- Made a significant decision → update the project note immediately
- Finished research → update findings/conclusion
- Learned something that changes an existing note → update it now

Let the journal capture stand on its own for casual conversation or small decisions.

### 🧠 MEMORY.md - Your Hot Cache

- **ONLY load in main session** (direct chats with your human)
- **DO NOT load in shared contexts** (Discord, group chats, sessions with other people)
- Keep MEMORY.md focused on active working memory; do not duplicate USER.md or IDENTITY.md
- MEMORY.md is a cache of the vault, not a replacement for it

### 📝 Write It Down - No "Mental Notes"!

- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE
- "Mental notes" don't survive session restarts. Files do.
- When someone says "remember this" → write to the vault or update MEMORY.md
- **Text > Brain** 📝

### Writing to the Vault

Use the `zettelclaw` skill for full details. Quick reference:

- **Journal entries** use `## Log` / `## Todo` / `---` / `## Sessions`
- **Note types:** `evergreen`, `project`, `research`, `contact`
- **Frontmatter:** `type`, `tags` (pluralized), `created`, `updated`. Add `summary` (one-sentence description) on all types.
- **Naming:** Title Case. Projects end with `Project`. Research ends with `Research`. Evergreen titles are statements, not topics.
- **Templates:** Project = Goal + Log. Research = Question + Findings + Conclusion + Sources. Contact = Context + Notes. Evergreen = freeform prose.
- Add `[[wikilinks]]` during supervised note writing and nightly maintenance (not in hook output).
- Do NOT create new directories. Do NOT add `status` to notes.
