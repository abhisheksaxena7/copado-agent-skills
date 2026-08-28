# Copado Agent Skills

A collaborative catalog of portable Agent Skills for Copado workflows. Each `skills/<name>/` directory is a self-contained runtime payload; `SKILL.md` remains the source of truth and `catalog.json` provides discovery, compatibility, ownership, and independent release metadata.

## Available skills

- `copado-apps-script-webapp` `0.1.6`: private-by-default static, read-only Sheet, and vendored Canvas Apps Script web apps with stable `/exec` deployment safeguards.

## Install

Clone a reviewed release of this catalog:

```sh
git clone --depth 1 --branch copado-apps-script-webapp-v0.1.6 \
  https://github.com/abhisheksaxena7/copado-agent-skills.git
cd copado-agent-skills
```

Install for Cursor:

```sh
./install.sh copado-apps-script-webapp --version 0.1.6 --cursor
```

Install for Claude Code:

```sh
./install.sh copado-apps-script-webapp --version 0.1.6 --claude
```

Use `--all` to install the unchanged payload for both IDEs. Restart/reload the IDE or begin a new agent session after first installation. Existing installations are not overwritten unless `--force` is explicit.

Authoritative manual fallback: copy the unchanged `skills/copado-apps-script-webapp` directory to `~/.cursor/skills/` or `~/.claude/skills/`.

See `docs/EMPLOYEE_ONBOARDING.md` for prerequisites, invocation, profile selection, expected output, and human gates. See `docs/COMPATIBILITY_AND_RELEASES.md` for the supported version pair, upgrades, canary status, and the remaining `v1.0.0` gates.

## Validate and package

```sh
npm test
npm run validate
scripts/validate-skill.sh copado-apps-script-webapp
scripts/package-skill.sh copado-apps-script-webapp
```

Packages use namespaced versions such as `copado-apps-script-webapp-v0.1.6`; releasing one skill does not imply other skills changed.

## Add a skill

Copy `templates/new-skill`, add `VERSION`, references, scripts, fixtures, and a unique `catalog.json` entry. Keep executable product templates in separate repositories and pin immutable releases from the skill.

The catalog and template are public, but scaffolded applications, Google resources, IDs, credentials, URLs, and business data remain private. See `CONTRIBUTING.md`, `SECURITY.md`, and the pull request template. The repository owner confirmed provenance, Copado branding/republication approval, personal-account publication, and MIT compatibility.
