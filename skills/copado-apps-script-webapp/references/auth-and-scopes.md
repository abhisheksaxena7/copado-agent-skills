# Authentication and scopes

Authentication is a human action. Agents may verify tool availability but must not initiate `clasp login`, request pasted OAuth JSON, or upload credentials without explicit authorization.

Approved manifest contracts:

- Static/Canvas: no explicit OAuth scopes.
- Sheet: `https://www.googleapis.com/auth/spreadsheets.readonly` and `https://www.googleapis.com/auth/script.scriptapp`.
- Every profile: `webapp.access` is `DOMAIN`; `webapp.executeAs` is `USER_DEPLOYING`.

The Sheet profile uses the Advanced Sheets Service because `SpreadsheetApp.openById` requests broader access even for reads. `script.scriptapp` supports the optional edit-trigger setup that clears cache.

Any profile or service change requires manifest review, owner re-consent, and a test before merge. A stale consent grant can make the stable app fail immediately after deployment.

`CLASPRC_JSON` is an OAuth secret. Store it only as an authorized CI secret, write it with restrictive permissions on the runner, and never echo it.
