### 🔄 Vault Maintenance (During Heartbeats)

Periodically (every few days), use a heartbeat for **synthesis and linking** — not raw capture.

- The hook already appends `Done` / `Decisions` / `Open` / `Notes` bullets to daily journals.
- During sessions, meaningful project/research work should be written directly to those typed notes.

1. **Triage Inbox** — Read `00 Inbox/` items, extract into proper notes or discard
2. **Promote durable facts** — Review recent journal entries and turn reusable facts into standalone evergreen notes
3. **Retro-link journals** — Add `[[wikilinks]]` to journal entries after the fact (the hook deliberately avoids links)
4. **Patch project/research drift** — Surface journal facts that mention existing project/research notes but weren't captured there, then update those notes
5. **Track superseded knowledge** — If journal facts invalidate older notes, create/update notes with `supersedes` frontmatter
6. **Surface orphans** — Find notes with no incoming links (`obsidian orphans`) and link them
7. **Fix unresolved links** — Check `obsidian unresolved` and create notes for important missing targets
8. **Update MEMORY.md** — Review recent vault notes and update your hot cache with what matters
9. **Clean up** — Archive completed projects (`status: archived`), check for stale research

The vault is your memory. Keep it healthy.
