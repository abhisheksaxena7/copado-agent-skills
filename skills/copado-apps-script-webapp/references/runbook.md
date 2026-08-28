# Runbook

1. Classify the profile and collect the minimum configuration.
2. Run `scripts/preflight.sh scaffold`.
3. Dry-run `scripts/scaffold.sh`, then obtain approval before creating local or private GitHub resources.
4. Run `npm test` in the generated project.
5. Human: enable Apps Script API and run `clasp login`.
6. Human: create the development Apps Script project and its first domain-restricted web-app deployment.
7. Sheet only: set the Script Property, grant read-only Sheet access, enable Advanced Sheets Service, run `setup()`, and consent.
8. Configure approved GitHub secrets/variables and protect the production environment.
9. Merge through green CI. Development uses the existing stable deployment.
10. Test direct `/exec` access with a domain user, then the approved iframe/SalesHood host.
11. Human: dispatch production with typed confirmation and reviewer approval.

Never create a second deployment to publish an update. Never change a scope without re-consent and a direct-access test.
