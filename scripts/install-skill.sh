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
  command -v tar >/dev/null 2>&1 || { echo "tar is required to install a released version." >&2; exit 1; }
  command -v node >/dev/null 2>&1 || { echo "node is required to read catalog release metadata." >&2; exit 1; }
  temporary="$(mktemp -d)"
  trap 'rm -rf "$temporary"' EXIT HUP INT TERM
  tag="${skill}-v${version}"
  archive="${tag}.tar.gz"
  checksum="${archive}.sha256"
  repository="${COPADO_SKILLS_REPOSITORY:-$(node -e 'const c=require(process.argv[1]); process.stdout.write(c.repository)' "$root/catalog.json")}"
  repository_slug="${repository#https://github.com/}"
  repository_slug="${repository_slug%.git}"
  release_base="${COPADO_SKILLS_RELEASE_BASE_URL:-https://github.com/${repository_slug}/releases/download}"

  download() {
    url="$1"
    output="$2"
    if command -v curl >/dev/null 2>&1; then
      curl --fail --silent --show-error --location --output "$output" "$url"
    elif command -v wget >/dev/null 2>&1; then
      wget --quiet --output-document="$output" "$url"
    else
      echo "curl or wget is required to install a released version." >&2
      exit 1
    fi
  }

  download "$release_base/$tag/$archive" "$temporary/$archive"
  download "$release_base/$tag/$checksum" "$temporary/$checksum"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$temporary" && sha256sum -c "$checksum")
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$temporary" && shasum -a 256 -c "$checksum")
  else
    echo "sha256sum or shasum is required to verify a released version." >&2
    exit 1
  fi

  tar -tzf "$temporary/$archive" | while IFS= read -r entry; do
    case "$entry" in
      "$skill"|"$skill/"|"$skill/"*) ;;
      *) echo "Release archive contains an unexpected path: $entry" >&2; exit 1 ;;
    esac
    case "$entry" in
      /*|../*|*/../*|*/..) echo "Release archive contains an unsafe path: $entry" >&2; exit 1 ;;
    esac
  done
  tar -xzf "$temporary/$archive" -C "$temporary"
  source_dir="$temporary/$skill"
  [ -f "$source_dir/SKILL.md" ] || { echo "Release $tag does not contain $skill." >&2; exit 1; }
  released_version="$(tr -d '[:space:]' < "$source_dir/VERSION")"
  [ "$released_version" = "$version" ] || {
    echo "Release $tag contains VERSION $released_version instead of $version." >&2
    exit 1
  }
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
