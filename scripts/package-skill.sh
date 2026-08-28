#!/usr/bin/env sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
skill="${1:-}"
[ -n "$skill" ] || { echo "Usage: scripts/package-skill.sh SKILL" >&2; exit 2; }

"$root/scripts/validate-skill.sh" "$skill"
version="$(tr -d '[:space:]' < "$root/skills/$skill/VERSION")"
archive="$root/dist/${skill}-v${version}.tar.gz"
mkdir -p "$root/dist"
tar -czf "$archive" -C "$root/skills" "$skill"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$root/dist" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
else
  (cd "$root/dist" && shasum -a 256 "$(basename "$archive")" > "$(basename "$archive").sha256")
fi
echo "$archive"
