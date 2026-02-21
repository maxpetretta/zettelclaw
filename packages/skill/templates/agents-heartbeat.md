### 🔄 Memory Maintenance (During Heartbeats)

Heartbeats run frequently (often every ~30 minutes). Keep heartbeat passes lightweight.

- The hook already appends `Done` / `Decisions` / `Facts` / `Open` bullets to daily journals.
- During sessions (human present), meaningful project/research work should be written directly to `01 Notes/`.
- Full vault maintenance is handled by the dedicated nightly cron job `zettelclaw-nightly` in an isolated session.

Nightly cron maintenance responsibilities:
1. Review the past 24h of journals.
2. Update existing `project` / `research` / `contact` notes in `01 Notes/` (append-only, update frontmatter `updated` date).
3. Enforce two-way `[[wikilinks]]` whenever journal content maps to typed notes:
   - Journal -> typed note
   - Typed note -> source journal day/session
4. Synthesize net-new durable ideas into `00 Inbox/` for human promotion.
5. Check unresolved/orphan links and update MEMORY.md with important durable context.
6. If journal coverage is missing for more than 72 hours, flag it clearly as possible hook/cron failure.
