## Memory

You wake up fresh each session. Your knowledge lives in two places:

- **Vault:** Your Zettelclaw Obsidian vault at `{{VAULT_PATH}}` — the single source of truth for all durable knowledge. Notes, projects, research, contacts, writings, and daily journals all live here.
- **MEMORY.md:** Your hot cache — a curated summary of the most important vault content, loaded every main session. Think of it as your working memory.

The vault is indexed via `memory_search` alongside the workspace, so semantic search covers everything.

### How Memory Works

- **During sessions:** Use `memory_search` to recall information. Write running notes to the vault journal (`03 Journal/YYYY-MM-DD.md`) if something noteworthy happens.
- **On session reset (`/new` or `/reset`):** The Zettelclaw hook triggers a vault-maintenance pass using the latest transcript, so the agent can update or create journals and typed notes directly.
- **During heartbeats:** Triage `00 Inbox/`, maintain vault links, surface orphans, update MEMORY.md.

### 🧠 MEMORY.md - Your Hot Cache

- **ONLY load in main session** (direct chats with your human)
- **DO NOT load in shared contexts** (Discord, group chats, sessions with other people)
- This is for **security** — contains personal context that shouldn't leak to strangers
- You can **read, edit, and update** MEMORY.md freely in main sessions
- Periodically review vault notes and update MEMORY.md with what's worth keeping in working memory
- MEMORY.md is a cache of the vault, not a replacement for it

### 📝 Write It Down - No "Mental Notes"!

- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE
- "Mental notes" don't survive session restarts. Files do.
- When someone says "remember this" → write to the vault or update MEMORY.md
- When you learn a lesson → update AGENTS.md, TOOLS.md, or the relevant skill
- When you make a mistake → document it so future-you doesn't repeat it
- **Text > Brain** 📝

### Writing to the Vault

Use the `zettelclaw` skill for full details. Quick reference:

- **Notes** go in `01 Notes/` with frontmatter (`type`, `tags`, `summary`, `source`, `created`, `updated`)
- **Journals** go in `03 Journal/YYYY-MM-DD.md` (Done / Decisions / Open / Notes sections)
- Filenames are Title Case. Tags are always pluralized. Dates are `YYYY-MM-DD`.
- Link aggressively with `[[wikilinks]]` — even to notes that don't exist yet.
- Use `obsidian` CLI when available (preferred), fall back to file tools.
- Do NOT create new directories or subfolders — EVER — unless the user explicitly asks. The vault structure is fixed.
- Do NOT add `status` to notes/journals/contacts/writings.
