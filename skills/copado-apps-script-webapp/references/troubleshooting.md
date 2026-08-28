# Troubleshooting

## Apps Script API or clasp

Confirm the intended owner enabled the Apps Script API and completed `clasp login`. Do not inspect or print the OAuth file.

If `clasp run` says the function cannot run despite a valid script ID, open the Apps Script editor, run the setup/seed function manually, and complete OAuth consent in the intended owner account. `clasp create` accepts Apps Script container types such as `standalone`; `webapp` is a deployment type, not a valid create type.

## Authorization after a profile change

Compare the manifest with the profile contract. Re-run `setup()` for Sheet, complete re-consent in the owner account, and test directly before redeploying.

## Sheet data missing

Check the configured Script Property name/value, owner read access, Advanced Sheets Service, tab name, and approved headers. Keep fictional local samples so browser tests do not depend on Google.

## Deployment is green but stale

List deployments and compare the stable deployment ID's version with the version created by CI. The Apps Script deployment API can briefly return the old pointer after a successful redeploy, so use the generated helper's bounded verification retries. Treat a mismatch after all retries as failure; do not create another deployment.

On older macOS Bash, use the released helper rather than reintroducing empty-array expansion under `set -u`.

## Direct URL works but iframe does not

Keep `DOMAIN` access. Verify the viewer's Workspace session, third-party-cookie policy, host allowlists, and `ALLOWALL`. Test the exact stable `/exec` URL outside the host first.

## Canvas build fails

Ensure `src/App.tsx` exists, uses no absolute imports, and default-exports a React component compatible with the adapter. Re-run `npm run build:canvas`.

## Scaffold fails during `npm ci`

Confirm that both `package.json` and the root package entry in `package-lock.json` use the generated project name. Released scaffolds run `prepare-project.mjs` before `npm ci`; do not remove that step or use an unreviewed template branch.

## The IDE does not discover the skill

Confirm the complete skill directory, including `SKILL.md`, is under `~/.cursor/skills/` or `~/.claude/skills/`. Reload/restart Cursor or begin a new Claude Code session after first installation because existing agent sessions can retain an earlier skill snapshot.
