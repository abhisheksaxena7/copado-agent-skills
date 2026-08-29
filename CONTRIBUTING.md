# Contributing

Contributions use pull requests. Do not put credentials, private repository content, employee or customer data, live resource IDs/URLs, generated reports, or machine-specific paths in issues, fixtures, commits, or release artifacts.

Use a Conventional Commit pull-request title such as `feat(apps-script): add a profile` or `fix(installer): verify release checksums`.

## Add a skill

1. Copy `templates/new-skill/` to `skills/<domain-prefixed-name>/`.
2. Use a lowercase name of at most 64 characters with no leading, trailing, or consecutive hyphens.
3. Add `VERSION`, starting at `0.1.0`, and a `CHANGELOG.md` with an `Unreleased` section.
4. Add a unique `catalog.json` entry with owners, tested compatibility, and `<skill>-v<version>` release metadata.
5. Add a matching path owner to `CODEOWNERS`.
6. Add fictional trigger and behavior fixtures plus tests for the skill's safety boundaries.
7. Run all validation and package the skill before opening a pull request.

## Authoring contract

- `SKILL.md` must use official Agent Skills frontmatter: required `name` and `description`, with optional `license`, `compatibility`, `metadata`, and experimental `allowed-tools`.
- Keep metadata keys and values as strings. Include the owner, version, and domain; the metadata version must match `VERSION` and `catalog.json`.
- Describe both what the skill does and the requests that should trigger it.
- Keep `SKILL.md` under 500 lines and link supporting files directly, one level deep.
- Put detailed guidance in `references/`, executable helpers in `scripts/`, and small copied snippets or schemas in `assets/`.
- Use portable POSIX shell or Node.js. Detect prerequisites and return actionable errors; never install global software or authenticate silently.
- Dry-run before external mutations. Keep credentials, production actions, destructive operations, and visibility changes human-gated.

## Assets, samples, and executable templates

Use `assets/` for small files that belong to the skill payload and agent workflow. Do not embed a complete application scaffold in a skill or duplicate it as a catalog sample.

Complete executable products belong in a separately owned and versioned template repository or package. Pin every external scaffold by a reviewed semantic tag and exact commit SHA. Executable behavior changes land and release in the template first; then update the skill lock, changelog, references, and fixtures and test both releases together.

The catalog currently does not publish npm packages or Claude plugin bundles. Do not add a parallel distribution channel without a design review covering source-of-truth, synchronization, compatibility, provenance, and rollback.

## Change or remove a skill

- User-visible changes require a SemVer update in `VERSION`, `catalog.json`, frontmatter metadata, documentation examples, and package tests.
- Record the change under the matching version in the skill's `CHANGELOG.md`.
- Deprecations must name the replacement and support window. Remove a skill only after a documented deprecation release and owner approval.
- Existing generated applications never update automatically; document any migration or OAuth re-consent requirement.

## Validation

Run:

```sh
npm ci
npm run validate
npm test
scripts/validate-skill.sh <skill>
scripts/package-skill.sh <skill>
tar -tzf dist/<skill>-v<version>.tar.gz
```

Reviewers verify official frontmatter/schema compliance, Skills CLI installation, Cursor/Claude payload parity, package/checksum integrity, template locks, fictional fixtures, sensitive-content scans, and human gates.

## Review and release

Pull requests require a CODEOWNER review, a Conventional Commit title, and all required checks. Branch protection prevents direct pushes to `main`.

Only release maintainers may dispatch `release-skill.yml`. The workflow rejects existing tags and requires `VERSION`, frontmatter metadata, `catalog.json`, the changelog, and any template lock to agree. Releases use `<skill>-v<version>` and include a skill-only archive plus SHA-256 checksum.

## Collaborator roles

- Contributors propose changes through pull requests.
- Maintainers review and merge.
- Skill owners review domain behavior and compatibility.
- Release maintainers create namespaced releases and manage repository settings and secrets.
- The personal account owner controls collaborator and continuity changes.

## Ownership continuity

Because the repository is personally owned, keep at least two trusted Copado maintainers as collaborators where policy permits. Export repository settings and release artifacts to an approved backup, record recovery contacts outside this public repository, and transfer ownership to an approved Copado organization if the personal account becomes unavailable. Never put private contact details or recovery secrets here.
