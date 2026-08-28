# Troubleshooting

## Apps Script API or clasp

Confirm the intended owner enabled the Apps Script API and completed `clasp login`. Do not inspect or print the OAuth file.

## Authorization after a profile change

Compare the manifest with the profile contract. Re-run `setup()` for Sheet, complete re-consent in the owner account, and test directly before redeploying.

## Sheet data missing

Check the configured Script Property name/value, owner read access, Advanced Sheets Service, tab name, and approved headers. Keep fictional local samples so browser tests do not depend on Google.

## Deployment is green but stale

List deployments and compare the stable deployment ID's version with the version created by CI. Treat a mismatch as failure; do not create another deployment.

## Direct URL works but iframe does not

Keep `DOMAIN` access. Verify the viewer's Workspace session, third-party-cookie policy, host allowlists, and `ALLOWALL`. Test the exact stable `/exec` URL outside the host first.

## Canvas build fails

Ensure `src/App.tsx` exists, uses no absolute imports, and default-exports a React component compatible with the adapter. Re-run `npm run build:canvas`.
