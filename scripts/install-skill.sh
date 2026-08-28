#!/usr/bin/env sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
skill="${1:-}"
[ -n "$skill" ] || { echo "Usage: install.sh SKILL [--version X.Y.Z] (--cursor|--claude|--all) [--force]" >&2; exit 2; }
shift

version=""
cursor=false
claude=false
force=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) version="${2:?Missing --version value}"; shift 2 ;;
    --cursor) cursor=true; shift ;;
    --claude) claude=true; shift ;;
    --all) cursor=true; claude=true; shift ;;
    --force) force=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ "$cursor" = true ] || [ "$claude" = true ] || { echo "Choose --cursor, --claude, or --all." >&2; exit 2; }

source_dir="$root/skills/$skill"
[ -f "$source_dir/SKILL.md" ] || { echo "Unknown skill: $skill" >&2; exit 1; }
local_version="$(tr -d '[:space:]' < "$source_dir/VERSION")"
version="${version:-$local_version}"
printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "Version must be X.Y.Z." >&2; exit 2; }

temporary=""
if [ "$version" != "$local_version" ]; then
  command -v git >/dev/null 2>&1 || { echo "git is required to install a non-current version." >&2; exit 1; }
  temporary="$(mktemp -d)"
  trap 'rm -rf "$temporary"' EXIT HUP INT TERM
  tag="${skill}-v${version}"
  git clone --quiet --depth 1 --branch "$tag" https://github.com/abhisheksaxena7/copado-agent-skills.git "$temporary/catalog"
  source_dir="$temporary/catalog/skills/$skill"
  [ -f "$source_dir/SKILL.md" ] || { echo "Release $tag does not contain $skill." >&2; exit 1; }
fi

install_to() {
  base="$1"
  destination="$base/$skill"
  mkdir -p "$base"
  if [ -e "$destination" ]; then
    [ "$force" = true ] || { echo "Already installed: $destination (use --force to replace)" >&2; exit 1; }
    rm -rf "$destination"
  fi
  cp -R "$source_dir" "$destination"
  echo "Installed $skill v$version to $destination"
}

[ "$cursor" = false ] || install_to "${CURSOR_SKILLS_DIR:-$HOME/.cursor/skills}"
[ "$claude" = false ] || install_to "${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
