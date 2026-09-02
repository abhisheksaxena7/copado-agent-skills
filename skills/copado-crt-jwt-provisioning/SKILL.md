---
name: copado-crt-jwt-provisioning
description: "A Copado Robotic Testing job cannot authenticate to Salesforce / invalid_client or bad client id / JWT setup takes too long through the UI / a Connected App cannot be created because an org toggle blocks it. End to end: generate an RSA keypair, deploy a ConnectedApp or ExternalClientApp with its certificate through the Metadata API, pre-authorize the running user, and register the client id, username and private key as SENSITIVE project secrets rather than plaintext parameters. The one hard constraint: an External Client App's consumer secret is deliberately gated, so its JWT certificate is set once in the UI and everything afterwards is automatic. Also covers the org setting that blocks Connected App creation entirely and how to tell that case apart from a genuine failure."
license: MIT
compatibility: "Requires a Salesforce org, Metadata API deployment tooling, openssl for keypair generation, and a Copado Robotic Testing project when registering job secrets."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "copado-crt"
---

# JWT Connected App + CRT credential provisioning, end to end

Confirmed live, 2026-08-22, while wiring up a Copado Robotic Testing job.
This is a genuinely fast, fully-scriptable path from "nothing" to "CRT job has working JWT
creds" -- no manual UI setup on the CRT side at all, and only one metadata deploy on the
Salesforce side. The CRT-secrets-API half of this is widely believed not to work -- it does, and
it is a broadly reusable setup for any CRT project needing JWT auth into a target org.

## Step 1: Generate the RSA keypair + self-signed certificate (local, no org contact yet)

```bash
mkdir -p jwt-cert && cd jwt-cert
openssl genrsa -out my_jwt.key 2048
openssl req -new -x509 -key my_jwt.key -out my_jwt.crt -days 730 -subj "/CN=My App JWT/O=MyOrg/C=US"
```

`my_jwt.crt` is the PUBLIC certificate (safe to embed in deployable metadata). `my_jwt.key` is
the PRIVATE key -- gitignore it immediately, before it's ever staged, same standing rule as
every other credential (see the `salesforce-named-credential-provisioning` skill).

## Step 2: Deploy a Connected App configured for JWT Bearer Flow

Real, confirmed Metadata API shape (`ConnectedApp`, ~67.0):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ConnectedApp xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>My App JWT</label>
    <contactEmail>admin@example.com</contactEmail>
    <oauthConfig>
        <callbackUrl>https://login.salesforce.com/services/oauth2/callback</callbackUrl>
        <certificate>-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----</certificate>
        <consumerKey>SOME_UNIQUE_ALPHANUMERIC_STRING_8_TO_256_CHARS</consumerKey>
        <isAdminApproved>true</isAdminApproved>
        <scopes>Api</scopes>
        <scopes>RefreshToken</scopes>
    </oauthConfig>
    <profileName>System Administrator</profileName>
</ConnectedApp>
```

Key facts, confirmed via the real `meta_connectedapp.htm` Metadata API reference (dev docs
corpus) and live deploy attempts:
- `certificate` takes the PEM cert content directly (the `.crt` file's contents, unmodified).
- `consumerKey` can only be SET at creation (never edited after) -- generate one yourself
  (e.g. `python3 -c "import secrets; print(secrets.token_hex(20))"`) rather than letting
  Salesforce auto-generate one you'd then need to retrieve back out.
- `callbackUrl` is required even though JWT Bearer Flow never uses it -- any real, syntactically
  valid URL works as a placeholder.
- Pre-authorization for JWT (so users don't need an interactive consent screen) is
  `isAdminApproved: true` on `oauthConfig` PLUS listing the authorized profile(s) directly in
  the top-level `profileName` string array -- both are needed together.
- `scopes`: `Api` + `RefreshToken` cover a typical JWT-bearer-for-API-access use case.

## Confirmed by Salesforce's own official skill library (2026-08-22)

`forcedotcom/sf-skills`'s `integration-connectivity-connected-app-configure` skill (installed via
`npx skills add forcedotcom/sf-skills`) was checked in full for this. **Every JWT Bearer example
in it targets the legacy `ConnectedApp`, none target `ExternalClientApplication`/ECA** -- this
corroborates, not contradicts, the manual finding below (no certificate/consumerKey field
anywhere in ECA's documented schema). Even Salesforce's own official skill hasn't caught up to
documenting ECA+JWT as a Metadata-API-deployable combination.

Also worth carrying forward: that skill's JWT certificate pattern is a **name reference to a
separately-uploaded `Certificate` metadata component** (`<certificate>MyCertName</certificate>`,
created via Setup > Certificate and Key Management first, then referenced by name) -- not
necessarily the raw inline PEM string the plain `meta_connectedapp.htm` field description
implies ("PEM-encoded certificate string"). An earlier Connected App attempt used inline
PEM and never got far enough to test which is actually accepted (blocked by an org-level
Connected-App-creation restriction first). Open, unresolved if a fresh Connected App is ever
created in an unrestricted org -- try the name-reference pattern first, since it's what the
official skill recommends.

## External Client App (the modern replacement for Connected App) -- partial findings, 2026-08-22

Salesforce is deprecating Connected Apps in favor of **External Client Apps** (ECA). Confirmed
real metadata types exist (`ExternalClientApplication` [.eca], `ExtlClntAppOauthSettings`
[.ecaOauth], `ExtlClntAppOauthConfigurablePolicies` [.ecaOauthPlcy],
`ExtlClntAppGlobalOauthSettings`) -- but a plain search of their documented fields shows no
`certificate`/`consumerKey`/`consumerSecret` field anywhere, unlike legacy `ConnectedApp`.
**User's correction, confirmed real**: the certificate upload field lives behind an **"Enable
JWT Bearer Flow"** checkbox in the External Client App Manager UI -- it's a UI-revealed field,
not something visible in the plain field-by-field Metadata API reference docs (which is why the
static schema search didn't surface it). Pre-authorization on ECA uses
`commaSeparatedProfile`/`commaSeparatedPermissionSet` on `ExtlClntAppOauthConfigurablePolicies`
(the ECA equivalent of legacy `ConnectedApp.profileName`), gated behind
`permittedUsersPolicyType = AdminApprovedPreAuthorized`. Two org-level opt-ins are required
before ECA is usable at all: "Opt in to External Client Apps" (base access) and "Allow Access to
OAuth Consumer Secrets via Metadata API" (for the OAuth plugin specifically) -- neither
confirmed deployable via metadata, likely Setup-UI-only toggles. **Not yet fully mapped end to
end** -- if picking this up again, the working recipe (once the JWT Bearer Flow checkbox and its
resulting certificate field are set through the UI) is likely: create/edit the ECA in Setup,
enable JWT Bearer Flow there, get the resulting Consumer Key, then everything from Step 3
onward in this skill (the PACE v3 secrets API) applies unchanged -- registering the client_id/
username/private_key as CRT job variables doesn't care which app type produced the client_id.

**Real failure mode hit live**: some orgs have Connected App creation disabled entirely --
deploy fails with `"You can't create a connected app. To enable connected app creation, contact
Salesforce Customer Support."` Seen on a partner/demo org.

**CORRECTED 2026-08-23 (user, who has done this):** the error message is misleading. In many
orgs this is SELF-SERVICE and does NOT need a Support case -- there is a Setup toggle. Give the
user this exact path before telling them to contact Salesforce:

1. Gear icon (top right) -> **Setup**
2. Quick Find -> **External Client Apps** -> **Settings**
3. Find the **Connected Apps** section on that page
4. Toggle **Allow creation of connected apps** to **On**
5. Click **Enable** on the confirmation dialog

Once enabled, a **New Connected App** button appears on that same settings page. Only if the
toggle is absent or blocked does this become a Support case. Do not repeat the old advice of
going straight to Support -- it sends people away for something they can usually fix in 30
seconds.

## Step 3: Register the resulting credentials as CRT job variables -- the real API

**This is the part previously believed not to work.** The correct endpoint is a `v3` one, not
alongside the `v4` build/trigger endpoints, and it's
DIFFERENT from the cookie-only `test-data.robotic.copado.com` Data Tables service documented in
`copado-crt-pace-batch-trigger` (that one really is unreachable with a plain API token -- don't retry
that one). This one works with the same plain token as everything else:

```
POST https://robotic.copado.com/pace/v3/projects/{projectId}/secrets
Content-Type: application/json
X-Authorization: <raw PACE API token, no "Bearer" prefix>
```

Body is a JSON ARRAY of secret objects:

```json
[
  {
    "key": "MyApp_client_id",
    "value": "SOME_UNIQUE_ALPHANUMERIC_STRING_8_TO_256_CHARS",
    "description": "JWT connected app consumer key",
    "sensitive": false,
    "type": "dataset",
    "jobId": 198169
  }
]
```

Confirmed live: `sensitive: false` -> HTTP 201, `"encrypted": false` in the response.
`sensitive: true` -> HTTP 201, `"encrypted": true` in the response -- the platform genuinely
encrypts it at rest when asked to. Real fields on each array item (`V3SecretData`, from the
real OpenAPI spec at `https://api.pace.qentinel.com/pace/spec/swagger-ui-init.js`): `key`
(required), `value`, `description`, `sensitive` (bool, default true), `type` (enum:
`config`/`clp`/`dataset`/`secret`), `jobId`, `machineId`, `robotId`, `userSpecific` (bool --
scopes visibility to only the calling user). Use `type: "dataset"` for anything that needs to
resolve as a plain `${variable}` inside a `.robot` test (matches the same variable-injection
shape as `copado__Selenium_Group_Variable__c` / the UI's own Selenium Group Variables). Scope
with `jobId` to keep a secret from leaking across unrelated jobs in the same project. A
`DELETE` on the same path exists too (query params `jobId`/`machineId`/`robotId`/`type`), for
cleanup/rotation.

**Finding the real endpoint when the docs don't cover it**: same method as the batch-trigger
discovery in `crt-pace-batch-trigger` -- pull the real OpenAPI spec from
`api.pace.qentinel.com/pace/spec/swagger-ui-init.js` and grep its `"paths"` section for
plausible keywords (`variable`, `secret`, `environment`) rather than assuming a capability
doesn't exist just because a UI-only flow is the only one you've tried before.

## Step 4: Point the `.robot` suite at the variables

```robot
*** Variables ***
${MyApp_client_id}      NOT_SET
${MyApp_username}       NOT_SET
${MyApp_private_key}    NOT_SET

*** Keywords ***
Authenticate To Salesforce
    JwtAuthenticate    ${MyApp_client_id}    ${MyApp_username}    ${MyApp_private_key}
```

The `*** Variables ***` block's default values get overridden by whatever CRT resolves for the
job at runtime (matching the job-scoped secrets set in Step 3) -- same override behavior
already proven for the dev-docs crawl's dataset parameters.

## CORRECTION 2026-08-23: the ECA findings above were WRONG in one direction and right in the other

Settled from the real Metadata API reference (local dev-docs corpus, 45,672 docs), not from a
field-name search that missed the relevant type.

**WRONG above**: "no `certificate`/`consumerKey` field anywhere" for ECA. They exist -- just not
on `ExtlClntAppOauthSettings` (the plugin settings, which really has none: its fields are
asset-token, IP-range, scope and attribute settings only). They live on
**`ExtlClntAppGlobalOauthSettings`**:
- `certificate` -- "the PEM-encoded certificate string. **When provided, it enables the JWT Bearer
  flow.**" (API 60.0+). So there is NO separate JWT checkbox at the metadata level; supplying the
  certificate IS the enablement. The UI checkbox is a UI affordance, not the underlying model.
- `consumerKey` -- the client_id. Also `consumerSecret`, `callbackUrl`, `isPkceRequired`,
  `isNamedUserJwtEnabled`, and the rest.

**RIGHT above, and now confirmed as a hard wall**: that type is gated. Both it and
`ExtlClntAppOauthSettings` carry the same Special Access Rules -- org permission "Allow Access to
OAuth Consumer Secrets via Metadata API" plus the user permission "View External Client Apps
Consumer Secrets in Metadata". And the type's own description says it "can't be packaged and must
not be added to source control."

**The gate cannot be opened any more**: `ExternalClientAppSettings.enableConsumerSecretApiAccess`
-- the org toggle that would have unlocked it -- is **DEPRECATED**, with the reference explicitly
saying *"Use the external client app OAuth UI to access consumer secrets."* Salesforce blocks this
by default now as a security enforcement, precisely to stop consumer secrets landing in source
control. **Do not burn time trying to enable it.** (Note `enableClientSecretInRestApiAccess`,
API 62.0+, is a DIFFERENT and NOT-deprecated toggle covering the credentials REST API -- an
unexplored lead if a programmatic route is ever needed again.)

**Consequence for automating CRT JWT setup**: the ECA create + certificate + consumer-key half is
UI-bound. Everything else is fully scriptable -- openssl keypair, the PACE v3 secrets push
(Step 3 above), the `.robot` wiring (Step 4), and verification by a real build. Build the tool as
a capability ladder: attempt metadata, fall back to browser automation, fall back to guided manual
with an exact click path. Discover per-org rather than assuming globally.

**Also note `PermissionsExternalClientAppDeveloper` / `...Admin` / `...Viewer` are real, grantable
PermissionSet fields** (confirmed live via describe), so the USER half of the gate is deployable
even though the ORG half is not.

**Why ECA at all (2026-08-23)**: Copado has primarily moved to ECA for CRT usage.
The driver is avoiding phishing-resistant MFA challenges under Salesforce's passkey enforcement on
privileged users -- and even ECA is not a perfect answer to that. Practical consequence: default
the JWT run-as user to a purpose-made INTEGRATION user, not an admin, which both reduces blast
radius and sidesteps the passkey enforcement that motivated the shift.

## CORRECTION 2026-08-23 (second): the ECA metadata route WORKS. Proven live, twice wrong before.

The section above concluded from the Metadata API reference that ECA JWT credentials are not
deployable, because both types carry Special Access Rules naming the org permission "Allow Access
to OAuth Consumer Secrets via Metadata API", and the toggle that would grant it
(`ExternalClientAppSettings.enableConsumerSecretApiAccess`) is DEPRECATED. **That reasoning was
wrong.** Those access rules gate READING consumer secrets back OUT via Metadata API. They do not
prevent DEPLOYING an ECA with a `certificate` and a `consumerKey` you supply yourself.

**Proven live**: `ExtlClntAppGlobalOauthSettings` carrying `certificate` + `consumerKey` deployed
successfully into a Developer Edition org -- **one that BLOCKS legacy Connected App creation** -- and the resulting credential authenticated a real CRT build end to end. Verified
independently afterwards: both `ExternalClientApplication:CRTJWT_CRT_JWT` and its
`ExtlClntAppGlobalOauthSettings:CRTJWT_CRT_JWT` component exist in that org.

**So the whole setup can be fully automatic, no human steps, ~51 seconds** versus ~45 minutes by
hand. Always ATTEMPT the metadata rung and discover per-org; never assume the wall.

**Four ECA deploy facts, each found by a failure, not by the docs:**
- Scopes go in **`commaSeparatedOauthScopes`**, not repeated `<oauthScopes>` elements.
- **Element ORDER must follow the reference's field sequence.** Out-of-order elements are
  SILENTLY DROPPED and resurface later as a misleading "Enter the name of the parent external
  client app".
- **All four ECA components must deploy in ONE call.** A partial bundle reports the ECA created,
  then rolls back.
- **`consumerKey` is IMMUTABLE after creation.** Re-deploying a new one returns `Succeeded` and
  silently keeps the OLD key -- surfacing much later as `invalid_client_id`. Rotation needs a new
  app, not an edit. Mint a real JWT from your own machine BEFORE pushing anything to CRT; that
  gate is what catches this.

**Standing lesson, now three-for-three today**: Salesforce's own documentation described a
restriction that live behaviour did not enforce (this), the docs omitted a field that exists
(`ExtlClntAppGlobalOauthSettings.certificate`), and a capability probe run in the wrong
configuration produced a confidently wrong verdict (the Copado AI release agent). **Documentation
narrows where to look; only a live attempt settles whether something works.**
