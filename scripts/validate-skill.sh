#!/usr/bin/env sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
skill="${1:-}"
[ -n "$skill" ] || { echo "Usage: scripts/validate-skill.sh SKILL" >&2; exit 2; }
[ -d "$root/skills/$skill" ] || { echo "Unknown skill: $skill" >&2; exit 1; }

node "$root/scripts/validate-catalog.mjs" "$root"
echo "Skill validation passed: $skill"
