## Memory

You wake up fresh each session. Your knowledge lives in two places:

- **Vault:** Your Zettelclaw Obsidian vault at `{{VAULT_PATH}}` — the single source of truth for all durable knowledge. Notes, projects, research, contacts, writings, and daily journals all live here.
- **MEMORY.md:** Your hot cache — a curated summary of the most important vault content, loaded every main session. Think of it as your working memory.

The vault is indexed via `memory_search` alongside the workspace, so semantic search covers everything.

### How Memory Works

- **Layer 1 - Hook -> Journal (automatic on `/new` or `/reset`):** The hook appends one session section to `03 Journal/YYYY-MM-DD.md` using `## HH:MM — SESSION_ID` with `Done`, `Decisions`, `Facts`, and `Open`. It is journal-only raw capture: no wikilinks, no vault navigation, no note creation.
- **Layer 2 - Agent + Human -> Notes (during sessions):** When meaningful work happens with the human in the loop, update the relevant project/research notes directly in `01 Notes/`.
- **Layer 3 - Heartbeat -> Inbox (agent-only):** During heartbeats, review recent journals/sessions and synthesize durable atomic concepts into evergreen notes in `00 Inbox/` for human review. Heartbeats also add/fix wikilinks in journals, track superseded knowledge, and update MEMORY.md.

### When to Update the Vault Directly

If the human is present, update typed notes in `01 Notes/` during the session when work is meaningful:

- Completed a task on an active project → append a dated log entry to the project note
- Made a significant decision about a project → update the project note immediately
- Finished a research investigation → update findings/conclusion in the research note
- Learned something that changes an existing note → update that note now
- The journal captures raw events; typed notes capture structured knowledge

Let the journal capture stand on its own when:

- Casual conversation with no actionable work
- Small decisions that don't affect project direction
- General facts the agent learns (heartbeats can synthesize these into `00 Inbox/` notes)

If the agent is working alone (heartbeat/maintenance), create new synthesis notes in `00 Inbox/`, not `01 Notes/`. Human review promotes them into `01 Notes/` by moving the file.

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

- **Session hook output** goes in `03 Journal/YYYY-MM-DD.md` only, as `## HH:MM — SESSION_ID` with `Done` / `Decisions` / `Facts` / `Open`
- **Human-supervised note updates** go in `01 Notes/` with frontmatter (`type`, `tags`, `summary`, `source`, `created`, `updated`)
- **Heartbeat-created notes** go to `00 Inbox/` first; human promotion moves them to `01 Notes/`
- Filenames are Title Case. Tags are always pluralized. Dates are `YYYY-MM-DD`.
- Add `[[wikilinks]]` during supervised note writing and heartbeat maintenance (not in hook output).
- Use `obsidian` CLI when available (preferred), fall back to file tools.
- Do NOT create new directories or subfolders — EVER — unless the user explicitly asks. The vault structure is fixed.
- Do NOT add `status` to notes/journals/contacts/writings.
