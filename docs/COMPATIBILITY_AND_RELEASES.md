# Compatibility and releases

## Compatibility contract

- Skill `0.2.0` pins template `v0.1.4` at commit `8b7ade2f4019ae64b1b82244cbb64bd4c7955bb0`.
- Cursor and Claude Code install the same `skills/copado-apps-script-webapp` payload.
- Skills CLI `1.5.23` and catalog validation require Node.js 22.20 or newer.
- Generated Apps Script projects support Node.js 20 or newer for initialization and browser smoke tests.
- The shell entry points are POSIX-compatible; the generated stable-redeploy helper also supports macOS Bash 3.
- Static and Canvas profiles declare no OAuth scopes.
- Sheet declares read-only Sheets access and the Apps Script API scope needed for setup.
- Apps Script deployments require a Copado Google Workspace account and domain-restricted web-app support.

The template tag and full commit SHA form the immutable executable dependency. Never change the pin to `main`, and never accept a tag whose resolved commit differs from the lock. Executable changes release in the template first; the skill then updates `template.json`, runs all profile fixtures, and releases independently.

## Upgrade procedure

1. Read both the template and skill release notes.
2. Review the exact new template tag, resolved commit, and manifest/workflow changes.
3. Update both the tag and full commit in `template.json` on a skill branch.
4. Run `npm test`, `npm run validate`, and `scripts/validate-skill.sh copado-apps-script-webapp`.
5. Scaffold and test `static`, `sheet`, and `canvas`.
6. If scopes changed, obtain human review and OAuth re-consent before redeployment.
7. Package the skill, verify its checksum, and publish a namespaced skill release.

Existing generated applications do not update automatically. Apply reviewed template changes in their own branches and retain each environment's deployment ID.

## v1.0.0 readiness

Completed on 2026-08-28:

- provenance, outbound MIT licensing, public-release authority, and sensitive-content gates;
- public template and catalog repositories, template mode, CI, and patch releases;
- all three local profile/browser fixtures and released-artifact checksum/install tests;
- identical installation payloads for Cursor and Claude Code directories;
- Cursor IDE invocation after a discovery refresh;
- live read-only Sheet canary with fictional data;
- rejection of non-domain access;
- one stable `/exec` URL advancing from Apps Script version 1 to version 2;
- production promotion remaining manual and reviewer-gated.

Still required before publishing `v1.0.0`:

- a Claude Code runtime invocation canary, deferred by the repository owner;
- approved iframe/SalesHood host testing where that integration is claimed;
- final review that no live IDs, private URLs, credentials, or business data are staged.

Until those gates pass, the current compatible pair remains skill `0.2.0` with template `v0.1.4` at the locked commit. Do not label either repository `v1.0.0` based only on local installation into a Claude skill directory.

## v1.0.0 release procedure

After the remaining gates pass:

1. Record approval outside the public repositories.
2. Run the full template and catalog test suites and staged-content scans.
3. Release the reviewed template commit as `v1.0.0`.
4. Pin that immutable template tag in the skill, set the skill and catalog metadata to `1.0.0`, and retest both IDEs.
5. Publish `copado-apps-script-webapp-v1.0.0` with its archive and SHA-256 checksum.
6. State the compatible template tag, canary outcomes, scope changes, and upgrade actions in both release notes.

## Distribution channels

The standard Skills CLI installation from GitHub is the primary cross-agent path. Namespaced GitHub releases with SHA-256 sidecars remain the exact-version and rollback path.

The repository does not currently publish an npm package, duplicate skills into a Claude plugin, or commit full generated applications as samples. Add one of those channels only when it has a distinct consumer and an automated synchronization/provenance design; it must not become a second editable source of truth.
