# Security model

- The public repositories contain generic code and fictional fixtures only; generated applications and business data remain private.
- Workspace authentication is enforced with `DOMAIN`; do not use `ANYONE` or `ANYONE_ANONYMOUS`.
- Apps execute as their owner. Ownership, Sheet sharing, and collaborator access require deliberate review.
- Use profile-minimal scopes. Read external Sheets through the Advanced Sheets Service.
- Put data-source IDs in Script Properties. Put environment IDs in ignored local files or CI variables.
- Whitelist outbound fields and sanitize links. Page source is visible to authorized viewers.
- Escape `</script` sequences before injecting JSON into HTML.
- Never commit `.clasprc.json`, `.env`, credentials, OAuth artifacts, owner emails, live URLs, or copied report data.
- Keep production promotion and repository visibility changes behind human approval.

`ALLOWALL` permits approved iframe rendering; it does not replace domain authentication. Never weaken access controls to work around iframe cookies.
