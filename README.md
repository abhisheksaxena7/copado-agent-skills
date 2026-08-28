# Copado Agent Skills

A collaborative catalog of portable Agent Skills for Copado workflows. Each `skills/<name>/` directory is a self-contained runtime payload; `SKILL.md` remains the source of truth and `catalog.json` provides discovery, compatibility, ownership, and independent release metadata.

## Available skills

- `copado-apps-script-webapp` `0.1.1`: private-by-default static, read-only Sheet, and vendored Canvas Apps Script web apps with stable `/exec` deployment safeguards.

## Install

Clone a reviewed release of this catalog, then:

```sh
./install.sh copado-apps-script-webapp --cursor
./install.sh copado-apps-script-webapp --claude
./install.sh copado-apps-script-webapp --all
```

Pin an independent skill release with `--version 0.1.1`. Existing installations are not overwritten unless `--force` is explicit.

Authoritative manual fallback: copy the unchanged `skills/copado-apps-script-webapp` directory to `~/.cursor/skills/` or `~/.claude/skills/`.

## Validate and package

```sh
npm test
npm run validate
scripts/validate-skill.sh copado-apps-script-webapp
scripts/package-skill.sh copado-apps-script-webapp
```

Packages use namespaced versions such as `copado-apps-script-webapp-v0.1.1`; releasing one skill does not imply other skills changed.

## Add a skill

Copy `templates/new-skill`, add `VERSION`, references, scripts, fixtures, and a unique `catalog.json` entry. Keep executable product templates in separate repositories and pin immutable releases from the skill.

See `CONTRIBUTING.md`, `SECURITY.md`, and the pull request template. The repository owner confirmed provenance, Copado branding/republication approval, personal-account publication, and MIT compatibility. Publication still requires an authenticated `abhisheksaxena7` GitHub CLI session and the paired template release.
