#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  cat <<'EOF'
Run local Zettelclaw smoke tests end-to-end.

Usage:
  scripts/run-local-smoke-tests.sh [options]

Options:
  --with-inference  Keep cloned workspace memory/ files and run full migrate inference.
                    Default behavior clears memory/ to avoid inference cost.
  --skip-tarball    Skip the installed-tarball smoke pass.
  --keep-tmp        Keep temporary smoke directory after completion.
  -h, --help        Show this help.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

run_step() {
  local title="$1"
  shift
  printf "\n== %s ==\n" "$title"
  "$@"
}

with_inference=0
skip_tarball=0
keep_tmp=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-inference)
      with_inference=1
      ;;
    --skip-tarball)
      skip_tarball=1
      ;;
    --keep-tmp)
      keep_tmp=1
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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

require_cmd bun
require_cmd node
require_cmd npm
require_cmd rsync
require_cmd openclaw

# Fail early if PATH contains a broken openclaw shim.
openclaw --help >/dev/null

smoke_root="$(mktemp -d "${TMPDIR:-/tmp}/zettelclaw-smoke-XXXXXX")"
if [[ "$keep_tmp" -eq 0 ]]; then
  trap 'rm -rf "$smoke_root"' EXIT
fi

echo "Smoke root: $smoke_root"

clone_profile() {
  local name="$1"
  "$repo_root/scripts/clone-openclaw-workspace.sh" --dest-root "$smoke_root" --name "$name" >/dev/null
  printf "%s\n" "$smoke_root/$name"
}

prepare_workspace_memory() {
  local workspace_dir="$1"
  if [[ "$with_inference" -eq 1 ]]; then
    return
  fi

  rm -rf "$workspace_dir/memory"
  mkdir -p "$workspace_dir/memory"
}

run_step "Install dependencies" bun install --frozen-lockfile
run_step "Lint" bun run lint
run_step "CLI tests" bun run cli:test
run_step "CLI build" bun run cli:build
run_step "Website build" bun run web:build

run_step "CLI prepack" bun run --cwd packages/cli prepack
run_step "npm pack dry-run" bash -lc "cd \"$repo_root/packages/cli\" && npm pack --dry-run >/dev/null"

tarball_name="$(cd "$repo_root/packages/cli" && npm pack --silent --ignore-scripts | tail -n 1)"
tarball_path="$repo_root/packages/cli/$tarball_name"
echo "Tarball: $tarball_path"

source_profile_dir="$(clone_profile source-smoke-profile)"
source_workspace_dir="$source_profile_dir/workspace"
source_vault_dir="$source_profile_dir/vault-smoke"
prepare_workspace_memory "$source_workspace_dir"

run_step "Source smoke: init" bun run cli:init --yes --vault "$source_vault_dir" --workspace "$source_workspace_dir"
run_step "Source smoke: migrate" bun run cli:migrate --yes --vault "$source_vault_dir" --workspace "$source_workspace_dir"
run_step "Source smoke: verify" bun run cli:verify --yes --vault "$source_vault_dir" --workspace "$source_workspace_dir"

if [[ "$skip_tarball" -eq 0 ]]; then
  tarball_app_dir="$smoke_root/tarball-app"
  mkdir -p "$tarball_app_dir"
  run_step "Tarball smoke: npm init" bash -lc "cd \"$tarball_app_dir\" && npm init -y >/dev/null"
  run_step "Tarball smoke: npm install zettelclaw tarball" bash -lc "cd \"$tarball_app_dir\" && npm install \"$tarball_path\" >/dev/null"

  installed_cli="$tarball_app_dir/node_modules/zettelclaw/bin/zettelclaw.js"
  run_step "Tarball smoke: help" node "$installed_cli" --help >/dev/null

  tarball_profile_dir="$(clone_profile tarball-smoke-profile)"
  tarball_workspace_dir="$tarball_profile_dir/workspace"
  tarball_vault_dir="$tarball_profile_dir/vault-smoke"
  prepare_workspace_memory "$tarball_workspace_dir"

  run_step "Tarball smoke: init" node "$installed_cli" init --yes --vault "$tarball_vault_dir" --workspace "$tarball_workspace_dir"
  run_step "Tarball smoke: migrate" node "$installed_cli" migrate --yes --vault "$tarball_vault_dir" --workspace "$tarball_workspace_dir"
  run_step "Tarball smoke: verify" node "$installed_cli" verify --yes --vault "$tarball_vault_dir" --workspace "$tarball_workspace_dir"
fi

echo
echo "Smoke tests passed."
if [[ "$keep_tmp" -eq 1 ]]; then
  echo "Temporary artifacts kept at: $smoke_root"
fi
