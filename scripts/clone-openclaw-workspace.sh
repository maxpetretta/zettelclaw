#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  cat <<'EOF'
Clone the current OpenClaw workspace into a temporary test directory.

Usage:
  scripts/clone-openclaw-workspace.sh [options]

Options:
  --source-workspace <path>  Source workspace to clone (default: ~/.openclaw/workspace)
  --dest-root <path>         Parent dir for clone output (default: ~/tmp)
  --name <value>             Clone directory name (default: openclaw-workspace-clone-<timestamp>)
  -h, --help                 Show this help.
EOF
}

expand_home() {
  local input="$1"
  case "$input" in
    "~")
      printf '%s\n' "$HOME"
      ;;
    "~/"*)
      printf '%s\n' "$HOME/${input#"~/"}"
      ;;
    *)
      printf '%s\n' "$input"
      ;;
  esac
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

source_workspace="~/.openclaw/workspace"
dest_root="~/tmp"
clone_name="openclaw-workspace-clone-$(date +%Y%m%d-%H%M%S)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-workspace)
      shift
      source_workspace="${1:-}"
      ;;
    --dest-root)
      shift
      dest_root="${1:-}"
      ;;
    --name)
      shift
      clone_name="${1:-}"
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

if [[ -z "$source_workspace" || -z "$dest_root" || -z "$clone_name" ]]; then
  echo "source workspace, dest root, and name must be non-empty" >&2
  exit 1
fi

require_cmd rsync

source_workspace="$(expand_home "$source_workspace")"
dest_root="$(expand_home "$dest_root")"
source_openclaw_dir="$(dirname "$source_workspace")"
source_openclaw_config="$source_openclaw_dir/openclaw.json"

if [[ ! -d "$source_workspace" ]]; then
  echo "Source workspace not found: $source_workspace" >&2
  exit 1
fi

mkdir -p "$dest_root"

clone_root="$dest_root/$clone_name"
clone_workspace="$clone_root/workspace"
clone_openclaw_config="$clone_root/openclaw.json"

if [[ -e "$clone_root" ]]; then
  echo "Clone target already exists: $clone_root" >&2
  exit 1
fi

mkdir -p "$clone_root"
rsync -a "$source_openclaw_dir/" "$clone_root/"
mkdir -p "$clone_workspace"
rsync -a "$source_workspace/" "$clone_workspace/"

if [[ -f "$source_openclaw_config" ]]; then
  cp "$source_openclaw_config" "$clone_openclaw_config"
else
  cat >"$clone_openclaw_config" <<'EOF'
{}
EOF
fi

cat <<EOF
Clone complete.

Source workspace:
  $source_workspace

Cloned workspace:
  $clone_workspace

Cloned config:
  $clone_openclaw_config

Example test commands:
  bun run --cwd packages/cli build
  node packages/cli/bin/zettelclaw.js init --yes --vault "$clone_root/vault" --workspace "$clone_workspace"
  node packages/cli/bin/zettelclaw.js migrate --yes --vault "$clone_root/vault" --workspace "$clone_workspace"

Optional: inspect cloned OpenClaw cron state directly:
  OPENCLAW_STATE_DIR="$clone_root" OPENCLAW_CONFIG_PATH="$clone_openclaw_config" openclaw cron list --json
EOF
