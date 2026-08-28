#!/usr/bin/env sh
set -eu

phase="${1:-scaffold}"
missing=""

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    missing="${missing}${missing:+, }$1"
    printf 'Missing %s: %s\n' "$1" "$2" >&2
  fi
}

require_command node "install Node.js 20 or newer using your approved package manager"
require_command npm "install npm with Node.js"
require_command git "install Git using your approved package manager"

if [ "$phase" = "github" ] || [ "$phase" = "deploy" ]; then
  require_command gh "install GitHub CLI and authenticate it yourself"
fi
if [ "$phase" = "deploy" ]; then
  require_command clasp "install the template-pinned clasp version and run clasp login yourself"
fi

if [ -n "$missing" ]; then
  printf 'Preflight failed; missing: %s. Nothing was installed.\n' "$missing" >&2
  exit 1
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$node_major" -lt 20 ]; then
  echo "Node.js 20 or newer is required. Nothing was installed." >&2
  exit 1
fi

echo "Preflight passed for $phase."
if [ "$phase" = "scaffold" ]; then
  command -v gh >/dev/null 2>&1 || echo "Later GitHub gate: gh is not installed."
  command -v clasp >/dev/null 2>&1 || echo "Later Google gate: clasp is not installed."
fi
