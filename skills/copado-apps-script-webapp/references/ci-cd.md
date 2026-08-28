# CI/CD and stable deployments

The `/exec` URL belongs to a deployment ID, not to the latest code. Creating another deployment produces another URL and strands embeds on the old version.

Every update must:

1. Run all profile/configuration/browser tests.
2. Synchronize or build `apps-script/index.html`.
3. `clasp push --force`.
4. `clasp create-version`.
5. `clasp redeploy STABLE_ID -V NEW_VERSION`.
6. List deployments and assert the stable ID points at `NEW_VERSION`.

Development may run after merge only when repository variables and secrets have been configured by a human. Production is manual, requires typed confirmation, and should use a protected GitHub environment with reviewers.

Keep `@google/clasp` pinned. Review command/output changes before upgrading because a successful command that leaves the stable pointer unchanged is a failed deployment.
