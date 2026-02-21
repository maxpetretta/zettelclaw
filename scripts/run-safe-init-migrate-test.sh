#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  cat <<'EOF'
Run zettelclaw init + migrate safely against a cloned OpenClaw workspace.

Usage:
  scripts/run-safe-init-migrate-test.sh [options]

Options:
  --test-root <path>   Where to create cloned test data.
  --profile <name>     OpenClaw profile name used for test commands.
  --model <name>       Optional model key/alias to pass to migrate.
  --skip-migrate       Run init only.
  --cleanup            Delete test root + test profile after completion.
  -h, --help           Show this help.

Environment overrides:
  SOURCE_OPENCLAW_DIR  Source OpenClaw state directory (default: ~/.openclaw)
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

now_stamp="$(date +%Y%m%d-%H%M%S)"
source_openclaw_dir="${SOURCE_OPENCLAW_DIR:-$HOME/.openclaw}"
test_root="$HOME/tmp/zettelclaw-test-$now_stamp"
profile_name="zc-test-$now_stamp"
run_migrate=1
cleanup=0
model=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --test-root)
      shift
      test_root="${1:-}"
      ;;
    --profile)
      shift
      profile_name="${1:-}"
      ;;
    --model)
      shift
      model="${1:-}"
      ;;
    --skip-migrate)
      run_migrate=0
      ;;
    --cleanup)
      cleanup=1
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
  shift
done

if [[ -z "$test_root" || -z "$profile_name" ]]; then
  echo "test root and profile must be non-empty" >&2
  exit 1
fi

require_cmd rsync
require_cmd npx
require_cmd openclaw
require_cmd mktemp

if [[ ! -d "$source_openclaw_dir" ]]; then
  echo "Source OpenClaw state dir not found: $source_openclaw_dir" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_openclaw_dir="$test_root/openclaw"
test_workspace_dir="$test_openclaw_dir/workspace"
test_vault_dir="$test_root/vault"
test_bin_dir="$test_root/bin"
test_profile_dir="$HOME/.openclaw-$profile_name"

if [[ -e "$test_root" ]]; then
  echo "Test root already exists: $test_root" >&2
  exit 1
fi

if [[ -e "$test_profile_dir" ]]; then
  echo "Test profile dir already exists: $test_profile_dir" >&2
  exit 1
fi

echo "Preparing isolated test environment..."
mkdir -p "$test_root"
rsync -a "$source_openclaw_dir/" "$test_openclaw_dir/"
rsync -a "$source_openclaw_dir/" "$test_profile_dir/"
mkdir -p "$test_bin_dir"

real_openclaw="$(command -v openclaw)"

cat >"$test_bin_dir/openclaw" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$real_openclaw" --profile "$profile_name" "\$@"
EOF
chmod +x "$test_bin_dir/openclaw"

# Ensure migrate has at least one file to process in test workspace.
mkdir -p "$test_workspace_dir/memory"
if ! find "$test_workspace_dir/memory" -maxdepth 1 -type f -name '*.md' | grep -q .; then
  today="$(date +%Y-%m-%d)"
  cat >"$test_workspace_dir/memory/$today.md" <<EOF
# Test Migration Seed

- This is test-only seed content for safe migrate validation.
EOF
fi

if [[ ! -f "$test_workspace_dir/MEMORY.md" ]]; then
  cat >"$test_workspace_dir/MEMORY.md" <<'EOF'
# MEMORY

Test profile memory cache file.
EOF
fi

echo "Running zettelclaw init against cloned workspace..."
(
  cd "$repo_root"
  PATH="$test_bin_dir:$PATH" npx --yes ./packages/cli init \
    --yes \
    --vault "$test_vault_dir" \
    --workspace "$test_workspace_dir"
)

if [[ $run_migrate -eq 1 ]]; then
  echo "Running zettelclaw migrate against cloned workspace..."
  migrate_args=(--yes --vault "$test_vault_dir" --workspace "$test_workspace_dir")
  if [[ -n "$model" ]]; then
    migrate_args+=(--model "$model")
  fi
  (
    cd "$repo_root"
    PATH="$test_bin_dir:$PATH" npx --yes ./packages/cli migrate "${migrate_args[@]}"
  )
fi

echo
echo "Safe test run complete."
echo "Test root:      $test_root"
echo "Test vault:     $test_vault_dir"
echo "Test workspace: $test_workspace_dir"
echo "Test profile:   $profile_name ($test_profile_dir)"
echo
echo "Watch migrate progress in isolated profile:"
echo "  openclaw --profile $profile_name tui --session isolated"
echo

if [[ $cleanup -eq 1 ]]; then
  echo "Cleaning up test artifacts..."
  rm -rf "$test_root"
  rm -rf "$test_profile_dir"
  echo "Cleanup complete."
else
  echo "Keeping artifacts for inspection."
  echo "Cleanup later with:"
  echo "  rm -rf \"$test_root\" \"$test_profile_dir\""
fi
