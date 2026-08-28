---
name: copado-apps-script-webapp
description: Scaffolds and guides domain-restricted Copado internal pages and Google Apps Script web apps, including static pages, read-only Sheet-backed dashboards, vendored Canvas/React publication, stable /exec deployments, and SalesHood or iframe embeds. Use when creating, converting, testing, deploying, or troubleshooting these apps.
---

# Copado Apps Script web app

Build from the pinned public template while keeping generated app repositories private, OAuth scopes minimal, credentials out of agent context, and deployment URLs stable.

## 1. Classify the profile

Choose exactly one:

- `static`: self-contained HTML; no Google data access and no OAuth scopes.
- `sheet`: vanilla page with safe local sample data and server-injected, whitelisted rows from the Advanced Sheets Service.
- `canvas`: vendored React/Canvas source bundled into one self-contained HTML file; no absolute source paths or external runtime dependencies.

Ask only for:

1. Repository/package slug.
2. Human-readable title.
3. Profile.
4. Storage-key namespace.
5. App chrome/kicker.
6. For `sheet`, Script Property name and approved Sheet fields.
7. For `canvas`, local source to vendor or confirmation to keep the sample `src/App.tsx`.

If a profile change affects scopes, stop for human review and re-consent.

## 2. Preflight

Run from this skill directory:

```sh
scripts/preflight.sh scaffold
```

Do not install global software automatically. Explain missing `node`, `npm`, `git`, `gh`, or `clasp` and let the human choose how to install/authenticate it.

## 3. Scaffold from the pinned release

First dry-run:

```sh
scripts/scaffold.sh --dry-run --profile static --name example-tool --title "Example Tool" --destination ./example-tool
```

After the user approves local creation, remove `--dry-run`. Add `--github OWNER/REPO` only after the user explicitly approves creating a **private** GitHub repository. The script never pushes, authenticates Google, uploads credentials, or deploys.

The template source and immutable release are pinned in `template.json`. Never scaffold from `main`. To upgrade:

1. Review a specific released template tag and paired release notes.
2. Update only `template.json`.
3. Run `scripts/verify-project.sh` against all three fixture profiles.
4. Release a new skill version.

## 4. Verify before Google setup

In the generated project:

```sh
npm test
npm run validate
```

Confirm:

- Manifest access is `DOMAIN` and execution is `USER_DEPLOYING`.
- Static/Canvas declare no OAuth scopes.
- Sheet declares only `spreadsheets.readonly` and `script.scriptapp`, uses `Sheets.Spreadsheets.Values.get`, and serializes whitelisted fields.
- Root and Apps Script HTML are identical.
- Browser smoke tests show visible content, interaction, safe sample/embedded data, no uncaught errors, and no mobile overflow.
- Canvas output has no external runtime dependency or unescaped closing-script sequence.

## 5. Stop at human gates

Obtain explicit human action or approval for each:

1. Enable the Apps Script API.
2. Run `clasp login`.
3. Create Apps Script projects and the first stable deployment per environment.
4. Set Script Properties and Sheet sharing.
5. Complete OAuth consent or re-consent.
6. Create GitHub secrets/variables.
7. Promote production.

Never ask the user to paste `CLASPRC_JSON`; never print, commit, or upload it without explicit authorization.

## 6. Preserve the stable URL

For every update, use the generated project's guarded workflow/script:

```text
create-version → redeploy existing deployment ID → verify pointer
```

Never create a replacement deployment for an existing environment. Production must remain manual, confirmation-protected, and reviewer-gated.

## 7. Troubleshoot in order

Test the stable `/exec` URL directly with an authorized domain account, then inspect OAuth/scopes and Script Properties, then iframe cookies/host configuration. Do not weaken `DOMAIN` access to fix an embed.

## References

- [Architecture and profile selection](references/architecture.md)
- [End-to-end runbook](references/runbook.md)
- [Authentication and scopes](references/auth-and-scopes.md)
- [CI/CD and stable deployment](references/ci-cd.md)
- [Security model](references/security.md)
- [Troubleshooting](references/troubleshooting.md)

## Manual installation

Copy this entire `copado-apps-script-webapp` directory unchanged to either `~/.cursor/skills/` or `~/.claude/skills/`. The shared catalog installer is a convenience; this directory is the authoritative portable payload.
