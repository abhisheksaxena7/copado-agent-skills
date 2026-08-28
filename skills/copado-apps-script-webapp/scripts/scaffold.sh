#!/usr/bin/env sh
set -eu

skill_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
profile=""
name=""
title=""
destination=""
storage_key=""
app_chrome="Copado · Internal"
sheet_property="APP_SHEET_ID"
canvas_source=""
github_repo=""
dry_run=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile) profile="${2:?Missing --profile value}"; shift 2 ;;
    --name) name="${2:?Missing --name value}"; shift 2 ;;
    --title) title="${2:?Missing --title value}"; shift 2 ;;
    --destination) destination="${2:?Missing --destination value}"; shift 2 ;;
    --storage-key) storage_key="${2:?Missing --storage-key value}"; shift 2 ;;
    --app-chrome) app_chrome="${2:?Missing --app-chrome value}"; shift 2 ;;
    --sheet-property) sheet_property="${2:?Missing --sheet-property value}"; shift 2 ;;
    --canvas-source) canvas_source="${2:?Missing --canvas-source value}"; shift 2 ;;
    --github) github_repo="${2:?Missing --github value}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$profile" ] && [ -n "$name" ] && [ -n "$title" ] && [ -n "$destination" ] || {
  echo "Required: --profile --name --title --destination" >&2
  exit 2
}
case "$profile" in static|sheet|canvas) ;; *) echo "Profile must be static, sheet, or canvas." >&2; exit 2 ;; esac
printf '%s' "$name" | grep -Eq '^[a-z0-9][a-z0-9-]*$' || { echo "Name must be a lowercase slug." >&2; exit 2; }
storage_key="${storage_key:-$name}"

"$skill_dir/scripts/preflight.sh" scaffold
template_repo="$(node -e 'const x=require(process.argv[1]); process.stdout.write(x.repository)' "$skill_dir/template.json")"
template_version="$(node -e 'const x=require(process.argv[1]); process.stdout.write(x.version)' "$skill_dir/template.json")"

echo "Pinned template: $template_repo@$template_version"
echo "Destination: $destination"
echo "Profile: $profile"
echo "Generated repository visibility: private"
echo "Human gates remain: GitHub creation, Google authentication, first deployments, secrets, production."
if [ "$dry_run" = true ]; then
  echo "Dry run complete; no files, repositories, credentials, or deployments were changed."
  exit 0
fi

[ ! -e "$destination" ] || { echo "Destination already exists: $destination" >&2; exit 1; }
git clone --depth 1 --branch "$template_version" "$template_repo" "$destination"
rm -rf "$destination/.git"
git -C "$destination" init -b main

if [ -n "$canvas_source" ]; then
  [ "$profile" = "canvas" ] || { echo "--canvas-source requires --profile canvas" >&2; exit 2; }
  [ -f "$canvas_source" ] || { echo "Canvas source not found: $canvas_source" >&2; exit 1; }
  cp "$canvas_source" "$destination/src/App.tsx"
fi

node "$skill_dir/scripts/prepare-project.mjs" "$destination" "$name"
(cd "$destination" && npm ci)
node "$destination/scripts/init-project.mjs" \
  --root "$destination" \
  --profile "$profile" \
  --name "$name" \
  --title "$title" \
  --storage-key "$storage_key" \
  --app-chrome "$app_chrome" \
  --sheet-property "$sheet_property"
(cd "$destination" && npm test)
node -e 'const c=require(process.argv[1]); if(c.profile!==process.argv[2]) throw new Error(`Tests changed profile to ${c.profile}; expected ${process.argv[2]}`)' \
  "$destination/project.config.json" "$profile"

if [ -n "$github_repo" ]; then
  "$skill_dir/scripts/preflight.sh" github
  gh repo create "$github_repo" --private --source "$destination" --remote origin
  echo "Created private GitHub repository $github_repo without pushing."
fi

echo "Scaffold complete. Review and commit locally; stop before Google authentication or deployment."
