---
name: salesforce-named-credential-provisioning
description: "Provision a Salesforce Named Credential and its External Credential from metadata instead of clicking through Setup, including the per-principal parameter shape, the permission-set grant that makes the credential usable, and the callout that proves it works. Covers why a Named Credential deploys clean and still returns an authentication error, why the External Credential principal needs an explicit permission-set mapping, and how to verify the credential from Apex rather than trusting the deploy. Use when wiring Salesforce to an external API, when a callout fails with an authorization error, or when moving a hand-built credential into source control."
license: MIT
compatibility: "Requires a Salesforce org and Metadata API deployment tooling (Salesforce CLI or equivalent). Callout examples assume an external HTTPS endpoint you control."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "salesforce-metadata"
---

# Provision a Salesforce Named Credential programmatically

Confirmed live, 2026-08-22, against a real Enterprise Edition org while building a Jira
integration. This is the fast path --
skip walking a human through Setup UI clicks when you can deploy the whole thing in two commands.

**Scope**: this is confirmed for the classic/legacy Named Credential shape --
`PrincipalType=NamedUser`, `Protocol=Password` (username + password/token, Basic-Auth-style).
The newer "Secured Endpoint" + External Credential split (a different metadata shape, seen as
`NamedCredentialType=SecuredEndpoint` on some Named Credentials in real orgs) has NOT been
tested this way -- don't assume the same required-fields behavior applies there without checking.

## The key facts that aren't obvious going in

- **Both `username` and `password` ARE required in the deployable metadata** for a
  Password-protocol Named Credential, contrary to the reasonable-sounding assumption that
  secrets can't be set via Metadata API at all. Salesforce's deploy error names exactly which one
  is missing if you leave it out (`"A username is required..."`, then separately `"A password is
  required..."` once username is added) -- so it's discoverable by just trying, not something
  you have to already know.
- **But you can never read a Named Credential's password back out afterward**, via any API --
  `sf sobject describe` / Tooling API queries never return it, and a metadata *retrieve* of an
  existing Named Credential omits it too. Write-only, permanently. Plan verification around a
  real functional test (an actual callout), never a "read it back to check" step.
- Re-deploying the SAME `.namedCredential-meta.xml` again (e.g. to rotate the password) should
  work the same way as the initial create -- not yet confirmed live, but there's no reason to
  expect it wouldn't, since the deploy always sends fresh username+password. Confirm this for
  real before relying on it if a real rotation need comes up.
- The `NamedCredential` component itself has **no Apex test-coverage requirement** -- deploy it
  on its own with a plain `sf project deploy start`, no `--test-level` flag needed. Only Apex
  classes deployed in the same payload trigger the coverage requirement.

## Steps

1. **Get the real credential safely -- never pasted raw into chat.** Ask for it via a new file
   in the project directory (any name), tab- or colon-separated `key: value` per line is fine.
   **Before reading it**, add that exact filename to `.gitignore` and confirm with
   `git check-ignore -v <file>` -- do this BEFORE the file could ever be staged, not after.
2. **Write `<Name>.namedCredential-meta.xml`** under
   `force-app/main/default/namedCredentials/`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <NamedCredential xmlns="http://soap.sforce.com/2006/04/metadata">
       <label>Human-Readable Label</label>
       <endpoint>https://the-target-host.example.com</endpoint>
       <principalType>NamedUser</principalType>
       <protocol>Password</protocol>
       <generateAuthorizationHeader>true</generateAuthorizationHeader>
       <allowMergeFieldsInBody>false</allowMergeFieldsInBody>
       <allowMergeFieldsInHeader>false</allowMergeFieldsInHeader>
       <username>the-account-identifier</username>
       <password>THE_REAL_SECRET_VALUE</password>
   </NamedCredential>
   ```

3. **Gitignore this exact file immediately**, before any `git add` touches the directory --
   add its path to `.gitignore` and re-run `git check-ignore -v` to confirm. This file carries a
   live secret in plaintext on disk; it must never be staged, let alone committed.
4. **(Recommended) Commit a redacted sibling** at the same path with `.example` appended
   (`<Name>.namedCredential-meta.xml.example`), same shape, placeholder values for
   username/password -- this DOES get committed, so the pattern's shape is documented in the
   repo itself for whoever reads it later, without ever holding the real secret.
5. **Deploy just that component**:
   `sf project deploy start --source-dir force-app/main/default/namedCredentials --target-org <alias>`
6. **Verify with a real functional call**, not a read-back (impossible, see above). If there's
   an Apex class already coded to call out via `callout:<Name>/...`, deploy it and invoke it
   (`sf apex run` with a short anonymous-Apex snippet, or `sf api request rest` against a
   `@RestResource` wrapper) and check the real response came back. If no consuming code exists
   yet, a minimal anonymous-Apex `Http` callout snippet against `callout:<Name>/<path>` is enough
   to prove the credential itself works before building anything on top of it.

## Custom auth headers (not standard Basic/Bearer) -- confirmed live 2026-08-22

Some APIs (Copado AI's gateway, for one) authenticate via a non-standard header --
`X-Authorization: <raw token>`, not `Authorization: Basic ...`/`Bearer ...`. A Password-protocol
Named Credential's `generateAuthorizationHeader: true` only ever produces a standard `Authorization`
header -- it can't be told to use a different header name. For a custom header, do this instead:

```xml
<generateAuthorizationHeader>false</generateAuthorizationHeader>
<allowMergeFieldsInHeader>true</allowMergeFieldsInHeader>
```

Then in Apex, set the header explicitly using the merge-field syntax, never the raw credential:

```apex
req.setHeader('X-Authorization', '{!$Credential.Password}');
```

Salesforce resolves `{!$Credential.Password}` to the real stored value only at send time -- the
literal merge-field string is what Apex code (and any callout mock in a test) actually sees.
Confirmed live: a real callout with this exact pattern reached Copado AI's real chat completions
API successfully. Same principle applies to any credential piece (username, password) that
needs to land somewhere other than the auto-generated standard header.

## Worked example

The case this was confirmed against: a fresh `Jira_Cloud` Named Credential (Jira Cloud, email + API token, Basic Auth) provisioned this way,
then verified live by calling a real Jira issue through an Apex REST broker and getting real
data back -- the exact recipe above, done for real, not hypothetical.
