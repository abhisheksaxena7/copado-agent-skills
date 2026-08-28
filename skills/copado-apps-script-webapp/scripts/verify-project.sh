#!/usr/bin/env sh
set -eu

project="${1:-.}"
[ -f "$project/project.config.json" ] || { echo "Not an Apps Script template project: $project" >&2; exit 1; }

node "$project/scripts/validate-config.mjs" --root "$project"
(cd "$project" && npm test)

node - "$project" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.private !== true) throw new Error('package.json must remain private.');
const ignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
for (const value of ['.clasprc.json', '.env', 'credentials.json']) {
  if (!ignored.includes(value)) throw new Error(`.gitignore must include ${value}`);
}
for (const file of ['.clasprc.json', '.env', 'credentials.json']) {
  if (fs.existsSync(path.join(root, file))) throw new Error(`Forbidden credential artifact exists: ${file}`);
}
console.log('Project safety verification passed.');
NODE
