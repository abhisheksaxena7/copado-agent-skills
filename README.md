# Copado Agent Skills

Portable, versioned Agent Skills for Copado workflows. This repository follows the open [Agent Skills specification](https://agentskills.io/specification) and uses the same canonical `skills/` layout as the [Salesforce Skills Library](https://github.com/forcedotcom/sf-skills).

The repository is the source of truth. Every `skills/<name>/` directory is a self-contained runtime payload. `SKILL.md` controls agent behavior; `catalog.json` adds ownership, compatibility, and independent release metadata.

Expect additive changes while the catalog is below `v1.0.0`. Released skill tags and checksums remain immutable.

## Available skills

- `copado-apps-script-webapp` `0.2.0`: creates private-by-default static, read-only Sheet, and vendored Canvas Apps Script web apps with stable `/exec` deployment safeguards.

Salesforce platform knowledge:

- `salesforce-url-navigation` `0.1.0`: URL-first navigation, the verified URL forms, environment host patterns, and the traps where a wrong URL renders a plausible page instead of an error.
- `salesforce-custom-object-build-checklist` `0.1.0`: the ordered checklist that takes a custom object from deployed to actually usable.
- `salesforce-permission-set-provisioning` `0.1.0`: the permission set that makes newly deployed custom fields visible to anyone, including administrators.
- `salesforce-named-credential-provisioning` `0.1.0`: provision a Named Credential from metadata and prove it with a real callout.
- `salesforce-apex-test-patterns` `0.1.0`: Apex tests that catch bugs rather than coverage, including the runAs permission harness.
- `salesforce-lwc-build-patterns` `0.1.0`: the LWC failures that live in Lightning's caching, action queue, and layout behavior rather than in your code.
- `salesforce-soql-data-integrity` `0.1.0`: why a SOQL result can be quietly short, and the reconciliation that catches it.

Copado product knowledge:

- `copado-cicd-object-model` `0.1.0`: what Copado CI/CD stores, and the read-only discovery method for extending the map.
- `copado-cicd-crt-handoff` `0.1.0`: diagnose a robotic test run's missing or wrong variables from the CI/CD records instead of by burning builds.
- `copado-crt-jwt-provisioning` `0.1.0`: end-to-end JWT provisioning for a Copado Robotic Testing job, including the External Client App path.
- `copado-crt-pace-batch-trigger` `0.1.0`: fire many robotic test builds in one call, with per-run parameters and safe response handling.

## Quick install

The standard Skills CLI supports Cursor, Claude Code, and other compatible agents directly from GitHub:

```sh
npx skills add abhisheksaxena7/copado-agent-skills \
  --skill copado-apps-script-webapp \
  --agent cursor --agent claude-code
```

Project scope is the default. Add `--global` for a user-level installation, `--yes` for reviewed non-interactive automation, or `--copy` where symlinks are not supported. Skills CLI `1.5.23` requires Node.js 22.20 or newer.

Manage the installation with the same CLI:

```sh
npx skills list
npx skills update copado-apps-script-webapp
npx skills remove copado-apps-script-webapp
```

Reload Cursor or start a new Claude Code session after first installation. Then ask:

```text
Create a private Copado Apps Script web app for a read-only Sheet dashboard.
```

See [employee onboarding](docs/EMPLOYEE_ONBOARDING.md) for prerequisites, profiles, expected output, and human gates.

## Exact released versions

Skills release independently with namespaced tags such as `copado-apps-script-webapp-v0.2.0`. For an exact release, clone its tag and use the fallback installer:

```sh
git clone --depth 1 --branch copado-apps-script-webapp-v0.2.0 \
  https://github.com/abhisheksaxena7/copado-agent-skills.git
cd copado-agent-skills
./install.sh copado-apps-script-webapp --version 0.2.0 --all
```

When asked for a non-current version, the fallback installer reads the repository location from `catalog.json`, downloads the namespaced release archive and SHA-256 sidecar, verifies the checksum, validates archive paths, and installs the unchanged payload. Existing installations require explicit `--force` replacement.

If neither installer is available, copy the complete skill directory unchanged to `~/.cursor/skills/` or `~/.claude/skills/`.

## Repository structure

```text
skills/                  canonical portable skill payloads
catalog.json             ownership, compatibility, and release index
catalog.schema.json      machine-validated catalog contract
templates/new-skill/     starting point for contributors
scripts/                 validation, packaging, and fallback installation
test/                    schema, safety, installer, and fixture tests
docs/                    employee and maintainer guidance
.github/workflows/       pull-request validation and guarded releases
```

Detailed instructions belong one level below `SKILL.md` in `references/`. Small snippets or schemas that an agent copies may live in a skill's `assets/`. Complete executable applications belong in separately versioned template repositories.

The Apps Script skill therefore pins the standalone [Copado Apps Script Web App Template](https://github.com/abhisheksaxena7/copado-apps-script-webapp-template) by release tag and exact commit. That separation preserves GitHub's **Use this template** flow, template-specific tests and releases, and direct use by employees who do not install an agent skill.

## Validate and package

Requires Node.js 22.20 or newer:

```sh
npm ci
npm run validate
npm test
scripts/validate-skill.sh copado-apps-script-webapp
scripts/package-skill.sh copado-apps-script-webapp
```

Validation covers the JSON Schema, official Agent Skills frontmatter, version/tag consistency, portable links and scripts, template locking, standard Skills CLI installation, private-by-default behavior, and package contents.

## Contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. It defines naming, frontmatter, references/assets, executable-template boundaries, fixtures, versioning, changelogs, ownership, and release review.

Executable template behavior changes release in the template repository first. The dependent skill then updates its exact pin and is tested against all profiles. Generic skill changes stay entirely in this repository.

Report security issues through the private process in [SECURITY.md](SECURITY.md). Use the skill request issue form for new workflow proposals and fictional trigger examples.

## Distribution boundaries

The standard Skills CLI and checksummed GitHub releases are the supported channels. npm publication, Claude plugin bundles, and committed full-application samples are intentionally deferred until they solve a concrete distribution need; they must not become parallel sources of truth.

The catalog and template are public. Generated applications, Google resources, credentials, IDs, private URLs, and business data remain private unless separately reviewed and approved.
