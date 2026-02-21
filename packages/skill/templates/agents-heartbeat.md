### 🔄 Vault Maintenance (During Heartbeats)

Periodically (every few days), run a heartbeat as an **agent-only, unsupervised synthesis pass**.

- The hook already appends `Done` / `Decisions` / `Facts` / `Open` bullets to daily journals.
- During sessions (human present), meaningful project/research work should be written directly to `01 Notes/`.
- During heartbeats (agent alone), new synthesized notes must go to `00 Inbox/` for human review and promotion.

1. **Review recent sessions** — Read recent journal sections and identify durable facts/concepts
2. **Synthesize to Inbox** — Create/append evergreen notes in `00 Inbox/` (one idea per note). Do not create heartbeat notes directly in `01 Notes/`
3. **Retro-link journals** — Add `[[wikilinks]]` to journal entries after the fact (the hook deliberately avoids links)
4. **Capture project/research drift** — If journals imply updates to existing project/research notes, write a structured handoff note in `00 Inbox/` for human review
5. **Track superseded knowledge** — If newer facts invalidate older notes, record `supersedes` relationships in inbox synthesis notes
6. **Surface orphans** — Find notes with no incoming links (`obsidian orphans`) and capture important relinking actions
7. **Fix unresolved links** — Check `obsidian unresolved` and capture/create important missing targets in `00 Inbox/`
8. **Update MEMORY.md** — Review recent vault content and update your hot cache with what matters
9. **Prepare human review** — Keep `00 Inbox/` organized so a human can promote accepted notes into `01 Notes/`

The vault is your memory. Keep it healthy.
