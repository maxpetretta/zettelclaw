#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  cat <<'EOF'
Run Zettelclaw v3 plugin smoke tests end-to-end.

Tests the full lifecycle: install → init → log write → query → search →
handoff → briefing → uninstall, all against real files (no gateway needed).

Usage:
  scripts/run-plugin-smoke-tests.sh [options]

Options:
  --keep-tmp   Keep temporary directory after completion.
  -h, --help   Show this help.
EOF
}

keep_tmp=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-tmp) keep_tmp=1 ;;
    -h|--help) print_usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; print_usage >&2; exit 1 ;;
  esac
  shift
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
plugin_dir="$repo_root/packages/plugin"
cd "$repo_root"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

pass() { printf "  ✅ %s\n" "$1"; }
fail() { printf "  ❌ %s\n" "$1"; exit 1; }
step() { printf "\n== %s ==\n" "$1"; }

require_cmd bun
require_cmd jq

smoke_root="$(mktemp -d "${TMPDIR:-/tmp}/zettelclaw-plugin-smoke-XXXXXX")"
if [[ "$keep_tmp" -eq 0 ]]; then
  trap 'rm -rf "$smoke_root"' EXIT
fi

echo "Smoke root: $smoke_root"

log_dir="$smoke_root/zettelclaw"
log_path="$log_dir/log.jsonl"
subjects_path="$log_dir/subjects.json"
state_path="$log_dir/state.json"
workspace_dir="$smoke_root/workspace"
openclaw_home="$smoke_root/openclaw"
config_path="$openclaw_home/openclaw.json"

mkdir -p "$workspace_dir" "$openclaw_home"

export OPENCLAW_HOME="$openclaw_home"

# ─── Unit tests ───────────────────────────────────────────────────────────────

step "Unit tests"
bun test --filter packages/plugin
pass "All plugin unit tests pass"

# ─── Plugin manifest ─────────────────────────────────────────────────────────

step "Plugin manifest validation"

manifest="$plugin_dir/openclaw.plugin.json"
[[ -f "$manifest" ]] || fail "openclaw.plugin.json not found"

plugin_id=$(jq -r '.id' "$manifest")
plugin_kind=$(jq -r '.kind' "$manifest")
[[ "$plugin_id" == "zettelclaw" ]] || fail "plugin id should be 'zettelclaw', got '$plugin_id'"
[[ "$plugin_kind" == "memory" ]] || fail "plugin kind should be 'memory', got '$plugin_kind'"
pass "Manifest: id=$plugin_id, kind=$plugin_kind"

# ─── Init ─────────────────────────────────────────────────────────────────────

step "Init (via bun import)"

# Write a minimal MEMORY.md
cat > "$workspace_dir/MEMORY.md" <<'MEMEOF'
# MEMORY.md - Working Memory

## Observations
- Testing zettelclaw v3 plugin

## Key Config State
- Model: test
MEMEOF

# Run init programmatically
bun -e "
import { runInit } from '$plugin_dir/src/cli/commands';
await runInit({
  logDir: '$log_dir',
  extraction: { model: 'test', skipSessionTypes: ['cron:', 'sub:', 'hook:'] },
  briefing: { model: 'test', activeWindow: 14, decisionWindow: 7, staleThreshold: 30, maxLines: 80 },
  cron: { schedule: '0 3 * * *', timezone: 'UTC' },
}, '$workspace_dir');
console.log('init ok');
"

# Verify init results
[[ -f "$log_path" ]] || fail "log.jsonl not created"
[[ -f "$subjects_path" ]] || fail "subjects.json not created"
[[ -f "$state_path" ]] || fail "state.json not created"
[[ -f "$config_path" ]] || fail "openclaw.json not created"

memory_slot=$(jq -r '.plugins.slots.memory // empty' "$config_path")
[[ "$memory_slot" == "zettelclaw" ]] || fail "memory slot not set to zettelclaw"

memory_flush=$(jq '.agents.defaults.compaction.memoryFlush' "$config_path")
[[ "$memory_flush" == "null" ]] || fail "memoryFlush not disabled"

grep -q "BEGIN GENERATED BRIEFING" "$workspace_dir/MEMORY.md" || fail "briefing markers not in MEMORY.md"
grep -q "Observations" "$workspace_dir/MEMORY.md" || fail "original MEMORY.md content lost"
pass "Init: log dir, config, MEMORY.md markers all correct"

# ─── Schema: write entries ────────────────────────────────────────────────────

step "Schema: write and read entries"

bun -e "
import { appendEntry, readLog, injectMeta } from '$plugin_dir/src/log/schema';

const entries = [
  { type: 'decision', content: 'Use Bun over yarn for all JS/TS', detail: '3-4x faster, one-way door', subject: 'tooling' },
  { type: 'fact', content: 'OpenClaw plugin SDK uses registerHook not api.on', subject: 'zettelclaw' },
  { type: 'task', content: 'Backfill script for 47 failed webhook jobs', status: 'open', subject: 'auth-migration' },
  { type: 'task', content: 'Set up CI pipeline', status: 'done', subject: 'zettelclaw' },
  { type: 'question', content: 'Is retry strategy sufficient for 10k+/min webhook bursts?', subject: 'auth-migration' },
  { type: 'handoff', content: 'Auth migration — retry logic done, backfill pending', detail: 'Exponential backoff working in staging. Need backfill script for 47 failed jobs.' },
];

for (const raw of entries) {
  const entry = injectMeta(raw, 'test-session-001');
  await appendEntry('$log_path', entry);
}

const log = await readLog('$log_path');
if (log.length !== 6) throw new Error('expected 6 entries, got ' + log.length);
console.log('wrote ' + log.length + ' entries');
"

entry_count=$(wc -l < "$log_path" | tr -d ' ')
[[ "$entry_count" -eq 6 ]] || fail "expected 6 lines in log.jsonl, got $entry_count"
pass "Wrote and read 6 entries"

# ─── Subjects: auto-create ────────────────────────────────────────────────────

step "Subjects: auto-create and list"

bun -e "
import { ensureSubject, readRegistry } from '$plugin_dir/src/subjects/registry';

await ensureSubject('$subjects_path', 'auth-migration', 'project');
await ensureSubject('$subjects_path', 'tooling', 'system');
await ensureSubject('$subjects_path', 'zettelclaw', 'project');

const reg = await readRegistry('$subjects_path');
const count = Object.keys(reg).length;
if (count !== 3) throw new Error('expected 3 subjects, got ' + count);
if (reg['auth-migration'].display !== 'Auth Migration') throw new Error('bad display name');
console.log(count + ' subjects registered');
"

subject_count=$(jq 'keys | length' "$subjects_path")
[[ "$subject_count" -eq 3 ]] || fail "expected 3 subjects, got $subject_count"
pass "3 subjects auto-created with correct display names"

# ─── Query: structured filters ───────────────────────────────────────────────

step "Query: structured filters"

bun -e "
import { queryLog } from '$plugin_dir/src/log/query';

const openTasks = await queryLog('$log_path', { type: 'task', status: 'open' });
if (openTasks.length !== 1) throw new Error('expected 1 open task, got ' + openTasks.length);
if (!openTasks[0].content.includes('Backfill')) throw new Error('wrong task: ' + openTasks[0].content);

const decisions = await queryLog('$log_path', { type: 'decision' });
if (decisions.length !== 1) throw new Error('expected 1 decision, got ' + decisions.length);

const bySubject = await queryLog('$log_path', { subject: 'auth-migration' });
if (bySubject.length !== 2) throw new Error('expected 2 auth-migration entries, got ' + bySubject.length);

console.log('structured queries ok');
"

pass "Structured filters: type, status, subject"

# ─── Query: keyword search ───────────────────────────────────────────────────

step "Query: keyword search"

bun -e "
import { searchLog } from '$plugin_dir/src/log/query';

const results = await searchLog('$log_path', 'webhook');
if (results.length !== 2) throw new Error('expected 2 results for webhook, got ' + results.length);

const staging = await searchLog('$log_path', 'staging');
if (staging.length !== 1) throw new Error('expected 1 result for staging, got ' + staging.length);

console.log('keyword search ok');
"

pass "Keyword search (ripgrep + fallback)"

# ─── Replacement resolution ──────────────────────────────────────────────────

step "Replacement resolution"

bun -e "
import { appendEntry, readLog, injectMeta } from '$plugin_dir/src/log/schema';
import { filterReplaced, getLatestVersion } from '$plugin_dir/src/log/resolve';

// Read current log to get the decision entry ID
const log = await readLog('$log_path');
const decision = log.find(e => e.type === 'decision');
if (!decision) throw new Error('no decision found');

// Write a replacement
const replacement = injectMeta(
  { type: 'decision', content: 'Use Bun over everything — yarn, pnpm, npm', detail: 'Updated preference', subject: 'tooling', replaces: decision.id },
  'test-session-002'
);
await appendEntry('$log_path', replacement);

// Verify
const updated = await readLog('$log_path');
const filtered = filterReplaced(updated);
const decisions = filtered.filter(e => e.type === 'decision');
if (decisions.length !== 1) throw new Error('expected 1 active decision, got ' + decisions.length);
if (!decisions[0].content.includes('everything')) throw new Error('wrong decision survived');

const latest = getLatestVersion(updated, decision.id);
if (!latest || latest.id !== replacement.id) throw new Error('getLatestVersion failed');

console.log('replacement resolution ok');
"

pass "Replacement chain: superseded entry filtered, latest resolved"

# ─── Handoff: getLastHandoff ─────────────────────────────────────────────────

step "Handoff retrieval"

bun -e "
import { getLastHandoff } from '$plugin_dir/src/log/query';

const handoff = await getLastHandoff('$log_path');
if (!handoff) throw new Error('no handoff found');
if (handoff.type !== 'handoff') throw new Error('wrong type: ' + handoff.type);
if (!handoff.content.includes('Auth migration')) throw new Error('wrong handoff content');
console.log('handoff ok: ' + handoff.content);
"

pass "getLastHandoff returns most recent handoff"

# ─── State: dedup tracking ───────────────────────────────────────────────────

step "State: extraction dedup"

bun -e "
import { markExtracted, markFailed, readState, isExtracted, shouldRetry, pruneState } from '$plugin_dir/src/state';

await markExtracted('$state_path', 'session-aaa', 3);
await markFailed('$state_path', 'session-bbb', 'LLM timeout');

const state = await readState('$state_path');
if (!isExtracted(state, 'session-aaa')) throw new Error('session-aaa should be extracted');
if (isExtracted(state, 'session-bbb')) throw new Error('session-bbb should not be extracted');
if (!shouldRetry(state, 'session-bbb')) throw new Error('session-bbb should be retryable');

// Second failure
await markFailed('$state_path', 'session-bbb', 'LLM timeout again');
const state2 = await readState('$state_path');
if (shouldRetry(state2, 'session-bbb')) throw new Error('session-bbb should NOT be retryable after 2 failures');

console.log('dedup tracking ok');
"

pass "Extraction dedup: mark, retry, permanent failure"

# ─── Subjects: rename ────────────────────────────────────────────────────────

step "Subjects: rename"

bun -e "
import { renameSubject, readRegistry } from '$plugin_dir/src/subjects/registry';
import { readLog } from '$plugin_dir/src/log/schema';

await renameSubject('$subjects_path', '$log_path', 'auth-migration', 'webhook-auth');

const reg = await readRegistry('$subjects_path');
if (reg['auth-migration']) throw new Error('old slug still exists');
if (!reg['webhook-auth']) throw new Error('new slug not found');

const log = await readLog('$log_path');
const oldRefs = log.filter(e => e.subject === 'auth-migration');
const newRefs = log.filter(e => e.subject === 'webhook-auth');
if (oldRefs.length !== 0) throw new Error('old slug still in log: ' + oldRefs.length);
if (newRefs.length !== 2) throw new Error('expected 2 renamed entries, got ' + newRefs.length);

console.log('rename ok');
"

pass "Subject rename: registry + log updated in-place"

# ─── Uninstall ────────────────────────────────────────────────────────────────

step "Uninstall"

bun -e "
import { runUninstall } from '$plugin_dir/src/cli/commands';
await runUninstall({
  logDir: '$log_dir',
  extraction: { model: 'test', skipSessionTypes: ['cron:', 'sub:', 'hook:'] },
  briefing: { model: 'test', activeWindow: 14, decisionWindow: 7, staleThreshold: 30, maxLines: 80 },
  cron: { schedule: '0 3 * * *', timezone: 'UTC' },
}, '$workspace_dir');
console.log('uninstall ok');
"

# Verify config reverted
memory_slot_after=$(jq -r '.plugins.slots.memory // "removed"' "$config_path")
[[ "$memory_slot_after" == "removed" ]] || fail "memory slot not removed after uninstall"

flush_after=$(jq '.agents.defaults.compaction.memoryFlush // "removed"' "$config_path")
[[ "$flush_after" == '"removed"' ]] || fail "memoryFlush not removed after uninstall"

# Verify MEMORY.md markers removed but content preserved
! grep -q "BEGIN GENERATED BRIEFING" "$workspace_dir/MEMORY.md" || fail "briefing markers still in MEMORY.md"
grep -q "Observations" "$workspace_dir/MEMORY.md" || fail "original MEMORY.md content lost after uninstall"

# Verify log data preserved
[[ -f "$log_path" ]] || fail "log.jsonl deleted by uninstall"
surviving_entries=$(wc -l < "$log_path" | tr -d ' ')
[[ "$surviving_entries" -eq 7 ]] || fail "log entries lost: expected 7, got $surviving_entries"

pass "Uninstall: config reverted, markers removed, log data preserved"

# ─── Summary ─────────────────────────────────────────────────────────────────

echo
echo "═══════════════════════════════════════"
echo "  All plugin smoke tests passed ✅"
echo "═══════════════════════════════════════"
if [[ "$keep_tmp" -eq 1 ]]; then
  echo "Temporary artifacts kept at: $smoke_root"
fi
