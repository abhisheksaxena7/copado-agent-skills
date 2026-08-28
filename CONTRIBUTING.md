# Contributing

## Author checklist

- Use a lowercase, hyphenated name and only `name`/`description` frontmatter.
- Keep `SKILL.md` under 500 lines and link references one level deep.
- Keep the skill self-contained; put application templates in separate repositories.
- Pin external templates/releases in one machine-readable file.
- Use portable POSIX shell or Node.js; detect prerequisites and never install/authenticate silently.
- Add fictional fixtures, dry runs, human-gate tests, owners, compatibility, `VERSION`, and a namespaced release tag.
- Run `npm test`, `npm run validate`, and package the changed skill.
- Document security, rollback, and upgrade behavior.

Executable template behavior changes land and release in the template repository first. Then update the skill pin/references and test both together.

## Review and release

Pull requests require a CODEOWNER review. Maintainers verify portability in Cursor and Claude Code, package contents, checksums, sensitive-data scanning, and human gates. Branch protection should require validation checks and prevent direct pushes to `main`.

Only maintainers with release permission may dispatch `release-skill.yml`. The requested version must match both `VERSION` and `catalog.json`; the tag is `<skill>-v<version>`.

## Collaborator roles

- Contributors propose changes through pull requests.
- Maintainers review and merge.
- Release maintainers create namespaced releases and manage repository settings/secrets.
- The personal account owner controls collaborator and continuity changes.

## Ownership continuity

Because the repository is personally owned, keep at least two trusted Copado maintainers as collaborators where policy permits. Export repository settings and release artifacts to an approved backup, record recovery contacts outside this public repository, and transfer ownership to an approved Copado organization if the personal account becomes unavailable. Never put private contact details or recovery secrets here.
