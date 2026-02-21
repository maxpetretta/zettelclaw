## Zettelclaw Heartbeat

- [ ] Keep heartbeat work lightweight (heartbeats run frequently).
- [ ] Do not run full vault synthesis/triage here unless the human explicitly asks.
- [ ] Nightly vault maintenance runs in a separate isolated cron session: `zettelclaw-nightly-maintenance`.
- [ ] If that cron job is missing or failing, surface it for the human to fix.
