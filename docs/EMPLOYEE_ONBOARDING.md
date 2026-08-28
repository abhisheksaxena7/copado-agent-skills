# Employee onboarding

Use the `copado-apps-script-webapp` skill when you need a Copado internal page, Sheet-backed dashboard, Canvas/React publication, stable Apps Script `/exec` URL, or approved iframe/SalesHood embed.

## Prerequisites

- Copado Google Workspace account with permission to own the Apps Script project.
- Node.js 20 or newer, npm, and git.
- Cursor or Claude Code.
- `clasp` only when you are ready for the Google setup phase.
- `gh` only when you explicitly want the skill to create a private GitHub repository.

Do not paste OAuth files, Sheet IDs, deployment IDs, private URLs, or production data into an agent prompt.

## Install in Cursor

From a reviewed catalog release:

```sh
./install.sh copado-apps-script-webapp --version 0.1.6 --cursor
```

Restart or reload Cursor after the first installation so the IDE refreshes skill discovery. Ask:

```text
Create a private Copado Apps Script web app for a read-only Sheet dashboard.
```

## Install in Claude Code

From the same reviewed release:

```sh
./install.sh copado-apps-script-webapp --version 0.1.6 --claude
```

Start a new Claude Code session after the first installation and use the same request. Both IDEs receive the unchanged portable skill directory; neither IDE is the source of truth.

## Answers the skill needs

1. Repository/package slug and human-readable title.
2. One profile: `static`, `sheet`, or `canvas`.
3. Storage-key namespace and optional app chrome.
4. Sheet profile: Script Property name and approved fields.
5. Canvas profile: source to vendor or approval to keep the fixture.

Choose `static` for no Google data access, `sheet` for whitelisted read-only rows, and `canvas` for a vendored React app built into self-contained HTML.

## Expected result

The skill dry-runs first, then creates a local, private-by-default project from the immutable template release pinned in `template.json`. The generated project runs profile validation and browser smoke tests before any Google action.

The agent must stop for a human to:

- enable the Apps Script API and run `clasp login`;
- create the first Apps Script project and stable deployment;
- configure Script Properties, Sheet sharing, OAuth consent, and GitHub secrets;
- approve production promotion.

## Security boundary

The public catalog and template contain reusable code, fictional fixtures, and instructions only. Generated repositories, Apps Script projects, Sheets, deployment URLs, credentials, and business data remain private. Do not make an app repository public without a separate authorized review.

## Direct template alternative

Employees who do not want an agent skill can open the public `copado-apps-script-webapp-template`, select **Use this template**, choose **Private**, and follow its README. The same tests and human gates apply.

For operational steps, see the skill's `references/runbook.md`. For common failures, see `references/troubleshooting.md`.
