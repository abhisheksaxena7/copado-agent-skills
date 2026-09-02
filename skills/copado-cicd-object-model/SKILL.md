---
name: copado-cicd-object-model
description: "Understanding Copado CI/CD's object model: what CI/CD actually stores, how a variable travels from CI/CD into a Copado Robotic Testing run, and which Salesforce objects hold the pipeline's configuration. Covers the JobTemplate to JobExecution to JobStep record graph and its JSON payload, the credential architecture, git repository storage, and the global Apex surface the managed package exposes. Includes the discovery method itself, using the Salesforce CLI and Tooling API, so the research extends to objects not listed here. Two findings that matter: a global proxy method reads and writes through stored credentials with no token minting, and a dynamic-expression evaluator resolves merge fields with no build firing. Load when extending CI/CD, wiring third-party integrations, or tracing data flow through the pipeline."
license: MIT
compatibility: "Requires a Salesforce org with the Copado CI/CD managed package installed and Salesforce CLI or Tooling API access. Read-only discovery; no external services."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "copado-cicd"
---

# Copado CI/CD real object model (ground truth, 2026-08-22)

Discovered by authenticating a live Salesforce org with the Copado managed package via the `sf` CLI and running
read-only `sf sobject describe` / `sf data query --use-tooling-api` calls -- not guessed, not
from docs. See "Discovery method" below to repeat/extend this against a different org or object.

## Pipeline execution engine (the core insight)

```
copado__JobTemplate__c            -- reusable template (like a workflow definition)
  -> copado__JobExecution__c      -- one run. copado__DataJson__c = the FULL JSON payload
       copado__Pipeline__c        -> copado__Deployment_Flow__c
       copado__Destination__c     -> copado__Environment__c
       copado__Source__c          -> copado__Environment__c
       -> copado__JobStep__c      -- ordered steps (copado__Order__c)
            copado__ConfigJson__c       -- step's input config, JSON
            copado__ResultDataJson__c   -- step's output, JSON
            copado__Type__c             -- "Behaviour": Function | Flow | Manual | Test
            copado__Quality_Gate_Rule__c / ..._Condition__c  -- gating, if this step gates
```

**Key finding**: Copado's own step-type vocabulary already includes **`Manual`** as a first-class
behaviour alongside `Function`/`Flow`/`Test` -- i.e. Copado CI/CD already models human-in-the-loop
gates as just another step type in the same execution chain, config-JSON-in /
result-JSON-out, same as every other step. Any new work that adds a "human approval" step type
to an agentic/orchestration layer on this platform is not inventing new vocabulary -- it's
extending an existing, already-proven one.

`copado__Quality_Gate_Rule__c` is a related but separate gating mechanism (attached to a
pipeline stage, not a single job step): own `copado__dataJson__c`, `copado__Tool__c` picklist
(`CRT`, `Apex Tests`, `Jest`, `PMD`, `sfdx-scanner`, `metadata-report-hs`, `SFDC Jest Test`,
`InsightAppSec`, `Copado Robotic Testing`), `copado__Actions__c` multipicklist (`Promotion`,
`PromotionDeployment`, `Commit`, `CreatePackage`, `CreatePackageVersion`,
`PublishPackageVersion`, `ImportPackage`, `TakeSnapshot`, `Rollback`, `PackageCreation`,
`PackageDistribution`, `SubmitUserStories`).

## Deployment object chain

```
copado__Deployment__c
  copado__From_Org__c          -> copado__Org__c  (source credential)
  copado__Build_Task__c        -> copado__Build_Task__c
  copado__Server_URL__c, copado__Execution_Context__c, copado__Last_Deployment_Execution_Id__c
  -> copado__JobExecution__c   (see engine above -- deployments run through the same engine)
```

## Test / variable-injection object chain (the CRT-adjacent objects)

```
copado__Test__c
  copado__ExtensionConfiguration__c   -- "Tool Configuration" (the actual tool binding)
  copado__User_Story__c, copado__LatestJobExecution__c
  -> copado__Test_Run__c              -- an execution record

copado__Selenium_Test_Group__c
  -> copado__Selenium_Group_Variable__c   -- Name / copado__Value__c pairs
       copado__Hide_Value__c              -- masks the value in UI (secret-style field)
       copado__Display_Value__c           -- the masked display string
```

`copado__Selenium_Group_Variable__c` is the Salesforce-side equivalent of PACE's
`inputParameters` array (`{key, type:"dataset", value}` -- see `crt-pace-batch-trigger` skill):
Name/Value child records that get compiled into a run's data payload. The `Hide_Value__c` /
`Display_Value__c` pair is a clean, simple secret-masking UX pattern worth reusing anywhere a
workflow-step param might hold a secret (store real value, display masked string).

`copado__Environmental_Variable__c` is a broader, environment-scoped version of the same
Name/Value shape (`copado__Scope__c` textarea for scoping rules).

## Apex layer (bodies are hidden -- managed package IP, confirmed via Tooling API)

Relevant class names found (via `SELECT Name FROM ApexClass WHERE Name LIKE '%Selenium%' OR
...` against Tooling API) -- **`Body` returns the literal string `"(hidden)"` for all of
these**, so behavior below is inferred from naming + object schema, not read source:

- `RunSeleniumTestGroup` -- almost certainly the orchestrator that gathers a test group's
  `Selenium_Group_Variable__c` children and fires the actual CRT/PACE call.
- `PostCRTVariable` / `CrtVariable` -- the outbound-call class(es) that push variable data to
  CRT as part of triggering a run.
- `DynamicVariablesInterpreter` -- almost certainly handles `{{}}`-style variable substitution
  within step configs/scripts at execution time -- the same substitution shape as
  `{{stepN.output.x}}`. The platform already does variable interpolation this way; any new
  orchestration layer you build on top of it should match that convention rather than inventing a
  different templating syntax.
- `EnvironmentalVariableTriggerHandler`, `SeleniumTestGroupTriggerHandler`,
  `SeleniumTestRunTriggerHandler`, `SeleniumTestResultTriggerHandler`, `SummaryVariableTrigger`
  -- confirms there IS real trigger automation on these objects (handler-class pattern, one
  handler per object), consistent with an event-driven "variable change -> propagate" or
  "test run completes -> roll up results" design. Cannot read the handler bodies to confirm
  exact logic.

## Credential architecture -- two distinct layers, confirmed live

**1. Transport layer** (Salesforce -> an external tool, to trigger/reach it at all): a
**static, shared Named Credential**. Confirmed via `SELECT DeveloperName, PrincipalType,
Protocol, NamedCredentialType FROM NamedCredential` (Tooling API) in a demo org:

| DeveloperName    | Endpoint                          | PrincipalType | Protocol |
|-------------------|------------------------------------|---------------|----------|
| CRT_SE_NA         | https://api.robotic.copado.com    | NamedUser     | Password |
| CRT_Testing       | https://api.robotic.copado.com    | NamedUser     | Password |
| CRT_Custom        | https://api-robotic.copado.com    | NamedUser     | Password |
| Jira_Integration  | https://<org>.atlassian.net       | NamedUser     | Password |
| ADO_Integration   | https://dev.azure.com/<org>       | NamedUser     | Password |

`PrincipalType=NamedUser` + `Protocol=Password` means: ONE shared service credential (the
PACE API token, stored as the Named Credential's "password" field) used for every call to that
tool, regardless of which human triggered the run. This is the same shape for CRT itself as for
third-party integrations -- there's no special-casing.

**2. Payload/data layer** (per-run dynamic values, e.g. a session token scoped to whoever
triggered the run, for CRT to act as that user against the org under test): NOT part of the
transport credential. Rides inside the run's own data -- the `Selenium_Group_Variable__c` /
`Environmental_Variable__c` Name/Value records that compile into `JobExecution__c.DataJson__c`
(or the equivalent for a test run). This is a deliberate separation: the channel used to reach
the tool is stable and shared; the identity a specific run acts as is dynamic, per-run data.

**Confirmed with real production `.robot` code (user-provided, 2026-08-22) -- this is the exact
mechanism**, a `Dynamic Login` keyword:

```robot
Dynamic Login
    [Documentation]             Login to Salesforce instance
    ${DYNAMIC_LOGIN}=           Get Variable Value          ${loginUrl}                 NoValuePassed
    IF                          '${DYNAMIC_LOGIN}' != 'NoValuePassed'
        GoTo                    ${DYNAMIC_LOGIN}
        ${current_url}=         GetUrl
        ${instance_url}=        Get Regexp Matches          ${current_url}              (https://.*\\.force\\.com)
        ${instance_url}=        Get From List               ${instance_url}             0
        Set Global Variable     ${home_url}                 ${instance_url}/lightning/page/home
        # ...other URLs rebuilt from the discovered instance_url...
    ELSE
        Static Login   # hardcoded test creds -- fallback for standalone (non-CI/CD) runs
    END
```

- `${loginUrl}` is a plain Robot Framework variable, only present when the run was actually
  triggered through CI/CD (`Get Variable Value ... NoValuePassed` is RF's own
  "does this variable exist" idiom) -- i.e. it's exactly one more dataset-style variable, same
  channel as `copado__Selenium_Group_Variable__c` rows / PACE `inputParameters`.
- Its VALUE is a single pre-authenticated URL (a "frontdoor"-style Salesforce login URL) minted
  SERVER-SIDE by Salesforce when the pipeline stage/quality gate fires the test -- not a raw
  session ID or JWT the test itself has to exchange for anything. `GoTo` that URL and the
  browser is simply already logged in.
- The instance URL (which varies -- sandbox subdomain, My Domain, etc.) is then DERIVED from
  wherever that redirect actually lands, via regex against the real post-redirect URL, and every
  other URL the suite needs gets rebuilt from that discovered value rather than hardcoded. Clean
  "one variable in, everything else self-configures" pattern.
- Falls back to `Static Login` (hardcoded username/password test variables) when running
  standalone, outside CI/CD.

**Directly reusable**: any browser-driving automation that needs to act against a specific
target org should adopt this exact `Dynamic Login`
pattern (accept a `loginUrl`-shaped param, `GoTo` it, derive the instance URL from the result)
rather than inventing new plumbing -- it's already a proven, production pattern for exactly this
problem.

**3. Target-Salesforce-org auth** (the org CI/CD is deploying to or testing against): a
**separate, third pattern** -- `copado__Org__c` ("Credential") + `copado__Custom_Connected_App_Info__c`
(`ClientId`/`ClientSecret`/`CallbackURL`, plain string fields -- `encrypted: false` on describe,
not natively field-encrypted) + `copado__Oauth_Signature__c`. This is a **custom JWT-bearer
credential system**, not a Named Credential, because standard Named Credentials are Setup-level
metadata too slow/heavy to provision at the rate CI/CD spins up sandboxes and scratch orgs.
**This is exactly what QForce's `JwtAuthenticate` keyword already authenticates against** -- CRT
already consumes this object today.

`copado__Continuous_Integration__c` (a CI job binding: Branch, Active, Status, Git_Repository__c,
`copado__Destination_Org_Credential__c` -> `copado__Org__c`) is where pattern 3 gets wired to an
actual pipeline stage.

**Named Credentials are deliberately opaque for READING -- but they CAN be written via Metadata
API deploy, confirmed live 2026-08-22.** There is no API that reads a Named Credential's
underlying secret back out (this part of the original claim holds -- confirmed by never once
seeing a password/token value returned from any describe/query). But creating a
NEW Password-protocol Named Credential via `sf project deploy` DOES require (and accept) both
`<username>` and `<password>` elements in the `.namedCredential-meta.xml` at create time --
Salesforce refuses the deploy without them ("A username/password is required for the specified
authentication protocol"). So: you can WRITE a secret in this way, you just can never read it
back out afterward (a subsequent retrieve of the same component omits the password). This means
"sync CI/CD's connection into CRT's vault" is still not achievable for an EXISTING
Named-Credential-backed integration (can't extract Jira_Integration's real secret to copy it
anywhere) -- but it does mean a NEW dedicated Named Credential can be provisioned
programmatically from a credential you already hold (e.g. from a gitignored local secrets
file) -- see the `salesforce-named-credential-provisioning` skill. The broker/proxy pattern (CRT calls
back into an Apex REST endpoint that uses the Named Credential internally) remains the right
model regardless -- this finding is about provisioning, not about how a keyword ultimately uses
the credential at runtime.

`copado__Git_Repository__c` stores repo connection METADATA (Provider, URI, base URLs, an
`copado__OAuth__c` boolean) but no direct credential field was found on it in this pass --
still open whether Git auth follows pattern 1 (Named Credential, likely, given the OAuth flag
and that GitHub/GitLab/Bitbucket support standard OAuth Named Credentials well) or something
else. Worth a follow-up describe pass if it becomes load-bearing for real work.

## Discovery method (repeatable, extend to other objects/packages)

```bash
# 1. Auth via CLI web login (no client secret handling needed on the automation side)
sf org login web --instance-url https://<org>.my.salesforce.com --alias <alias> --set-default

# 2. Full sobject list, then grep for a namespace/keyword
sf sobject list --target-org <alias> --json > sobjects.json
# then filter in Python/jq for 'copado__', 'copadoconnect__', or a keyword

# 3. Describe a specific object (fields, types, references, picklist values)
sf sobject describe --sobject copado__JobStep__c --target-org <alias> --json

# 4. Query real (non-secret) DATA rows for concrete examples, not just schema
sf data query --query "SELECT Id, Name, copado__Type__c FROM copado__JobStep__c LIMIT 10" \
  --target-org <alias> --json

# 5. Tooling API for metadata not exposed as normal sobjects (ApexClass, NamedCredential, etc.)
sf data query --query "SELECT Name FROM ApexClass WHERE Name LIKE '%Foo%'" \
  --target-org <alias> --use-tooling-api --json

# Managed-package Apex Body is hidden (returns literal "(hidden)", 8 chars) -- don't expect to
# read source for anything not in an unlocked/unmanaged package. Infer from object schema +
# class naming instead.
```

**Never print/log a Named Credential's `Password`/`OauthToken`/`OauthRefreshToken` field, or
any `copado__ClientSecret__c`/`copado__Token__c`/`copado__Oauth_Signature__c` value, if a query
ever returns one** -- same standing rule as the CRT build API's `executionParameters` leak.
The queries here never selected those fields; if you
need actual secret values (not just schema), treat that as a deliberate, confirmed-with-the-user
action, not a default.

## Known gaps (not yet explored)

- **`loginUrl`'s exact shape, and whether it doubles as an API credential.** User's read
  (2026-08-22, not 100% certain): likely a classic `frontdoor.jsp?sid=<token>&retURL=...` URL --
  if so, the `sid` value is a raw Salesforce session ID, and session IDs obtained that way are
  normally directly reusable as the Bearer token for REST/SOQL API calls too (not just the
  browser session), subject to whatever session/IP restrictions are configured. NOT yet
  confirmed against a real captured value -- treat it as unverified until you check it. To confirm for real: trigger
  an actual CI/CD-driven test run and log the real `${loginUrl}` value before the `GoTo` in
  `Dynamic Login`.

- Git repository credential storage -- see note above.
- Whether `copadoconnect__Copado_Integration__c`'s Named Credential is created/managed via an
  admin UI flow or requires manual Setup configuration per connection.
- Real deployment API mechanics (does Copado use the modern Metadata Deploy REST API, the SOAP
  Metadata API, sfdx-core under the hood, or its own bespoke deploy engine?) -- not determined
  from schema alone; would need either readable Apex (not available) or live network capture
  during an actual deployment (Claude-in-Chrome fetch interception, same method that found the
  PACE batch-trigger endpoint -- see `crt-pace-batch-trigger` skill).

---

# 2026-08-24 addendum — the programmatic entry-point surface (live-confirmed)

New facts from a read-only deep dive against the same org. Repeat the discovery method below to
regenerate per-action I/O schemas and minimal create-templates for every setup object in your own
org -- those are org-specific and belong beside your pipeline, not in this skill.

## The Apex API is far bigger than the two known entry points

**155 global classes** (135 `copado`, 17 `copadoQuality`, 3 `copadoconnect`) out of 2,518 managed
classes — recovered in ONE Tooling query (`SELECT Name, NamespacePrefix, SymbolTable FROM ApexClass
WHERE NamespacePrefix IN (…)`; SymbolTable comes back ONLY for global classes, so the filter is free).
And **53 `copado__*` invocable actions**, each callable from Flow, from Apex via
`Invocable.Action.createCustomAction('apex','copado__<Name>')`, AND via REST POST
`/services/data/vXX.0/actions/custom/apex/copado__<Name>` — where a GET on the same URL returns the
exact input/output schema with required flags. That GET is the cheapest ground truth on any
invocable's real parameters.

Key facades (signatures from SymbolTable, exact):
- `copado.Actions` — inner services with uniform `execute(Request)/status(jobExecutionId)`:
  CommitService, PromotionService, PromotionDeploymentService, PackageCreate/VersionCreate/Distribute,
  RunTestService (+schedule), GitSnapshotService (configure + takeSnapshot).
- `copado.Jobs.Execution` — `create / createFromTemplate / addSteps / execute / status / resume /
  cancel`. `createFromTemplate` takes a **credentialId** (the `copado__CreateExecution` invocable
  does not) — the direct way to pin which credential a run uses.
- `copado.Jobs.DynamicExpression.evaluate(contextId, expressions[])` — evaluates `{$...}` merge
  fields from Apex (`{value, isSensitive, errorMessage}`): test ConfigJson without burning a run.
- `copado.CopadoFunctions.execute({functionApiName, contextId, parameters, callback})` /
  `status(resultId)` / `cancel`.
- `copado.Promotions.CalculationService` — calculateForward/Backward/OutOfSyncBackwardPromotions →
  the promote-what engine, headless.
- `copado.Quality.matchingRules(...)/steps(...)` — dry-run which quality gates apply to an action.
- `copado.Feature.JWTSetting.*` — programmatic setup of Copado's JWT permission plumbing.
- `copado.GlobalAPI` — see next two items, plus `createUserAPIKey()` (mints the webhook API key),
  `getCopadoServerUrl()`, `upsertCopadoLicense(userId, …)`, `createPromotionPullRequest(...)`,
  `getRecentChanges(orgId)`.

## Git credential question CLOSED: auth is an API call, not a record field

`copado.GlobalAPI.authenticateGitRepository(Id gitRepositoryId, String username, String password)`
and the full `copado.RepositoryOAuth` class: `authenticate({repositoryId, authType, username,
password, extraHeaders})`, `createSSHKey/getSSHKey/addSSHKey`, `isAuthenticated(repoId)`,
`validateGitConnection(repoId)`, `resetRepository(repoId)`, `getLoginUrl` (provider OAuth),
`prepareGithubManifest`. So **HTTPS/PAT and SSH git auth are fully scriptable**; only the
OAuth-provider consent click is human. Secrets stay Copado-backend-side ("GCP secrets" per docs).

## Cross-org calls through a Copado credential (signature-confirmed, not yet exercised)

`copado.GlobalAPI.proxyOrgRequest(ProxyOrgRequest {requestType, endPointUrlService,
orgCredentialId, requestPayload}) → {statusCode, content, errorCode, errorMessage}` (+ a SOAP twin).
Token EXTRACTION stays impossible, but calls THROUGH the stored credential appear to be a supported
API. First live call = a write callout — verify with a harmless GET in a write-enabled session
before relying on it.

## Creatability: EVERY setup object is plain-DML creatable, with almost no schema-required fields

Describe-verified for 17 objects (Git_Repository, Environment, Org, Deployment_Flow(+Step), Project,
User_Story, Promotion, Quality_Gate_Rule(+Condition), Automation_Rule, JobTemplate, JobStep,
ExtensionConfiguration, Test, Custom_Connected_App_Info, Continuous_Integration): all
`createable=true`. Schema-required at insert, in total: Deployment_Flow_Step → Deployment_Flow;
JobStep → Type; ExtensionConfiguration → ExtensionApplication (`Test` only active value);
Quality_Gate_Rule → Execution_sequence + Tool; Quality_Gate_Rule_Condition → Rule + Platform +
Extension_Configuration; Automation_Rule → Pipeline; Custom_Connected_App_Info → ClientId +
ClientSecret + Connected_App_Id; Function → API_Name. Everything else (incl. Pipeline platform/repo,
Environment fields, User_Story's 101 fields) is schema-optional — the UI enforces more than the API.
Derive the minimal working create-template per object from a `describe` of its required fields.

`copado__Function__c` deserves note: custom platform functions are entirely record-defined —
bash `Script__c`, container `Image_Name__c`, `Worker_Size__c`, and `Parameters__c` whose
defaultValues take any dynamic expression, including `{$Context.Repository.Credential}` (the git
credential JSON handed into the container) and `{$Context.Credential.SessionId}`.

## Copado backend REST/webhook surface (docs-corpus-confirmed)

- **Legacy Webhooks API**: `{backend}/json/v1/webhook/...` with per-user `?api_key=` (Account
  Summary; or `GlobalAPI.createUserAPIKey()`). Endpoints: githook PR events per provider
  (`…/githook/event/pullrequest/provider/{github|gitlab|bitbucket|azure-devops|copado-version-control}/version/cloud`),
  metadata grid (`…/webhook/metadata/{ORG_CREDENTIAL_ID}?typeFiltered=true&types=…`),
  deleteGitBranches, code-analysis, copado_events (Connect). Resetting the user API key kills all of
  them.
- **Actions API** (current): "Actions API Key" records (scoped per action, 1–365 day expiry, die
  early on owner API-key reset or credential re-auth), sent as header **`copado-webhook-key`**;
  documented method Run Job Template (templateApiName + runAfterInstantiation + dataJSON →
  JobExecution Id). Full params only in Apiary, not the docs corpus. No sobject stores these keys.
- In-org `@RestResource` classes: `CliProxy` (the Copado CLI's endpoint), `MCWebhook`,
  `FunctionWebEvent` (function-completion callback: result_id/status/error_message/result_data/
  is_finished/is_success), `LicenseAPI`, `SeleniumTestCaseViewEdit`, `CodeScanHandshakeService`.

## Probably the headless "Generate Extension Records" (UNVERIFIED)

`copado.CreateStandardRecords.execute(String resourceName)` + `serialize(Set recordIds)` match the
Extension Setup "Generate Extension Records"/"Create Extension" pair exactly. If confirmed, trial-org
bootstrap loses its last big UI step. Verify before relying on it.

## Tooling gotcha for this environment

`sf` CLI (this machine) embeds ANSI color codes inside `--json` output when piped; every parse must
strip them first: `sed 's/\x1b\[[0-9;]*m//g'`. Aggregate SOQL (GROUP BY) against Tooling ApexClass
also fails — pull rows and count locally.

## proxyOrgRequest + DynamicExpression: BOTH VERIFIED LIVE 2026-08-24 (were "unverified" leads)

Two entry points the automation-surface deep dive could only confirm by signature are now
proven with real calls against a demo org (anonymous Apex, read-only):

**`copado.GlobalAPI.proxyOrgRequest`** -- a REST call INTO a target org THROUGH Copado's stored
credential, no token ever held by the caller. Proven: a GET to `/services/data` via the
"Data Cloud Dev" credential (`copado__Org__c` a11J7000000FRblIAG) returned **statusCode 200** and
2554 chars of real version-list JSON. Shape:
```apex
copado.GlobalAPI.ProxyOrgRequest req = new copado.GlobalAPI.ProxyOrgRequest();
req.orgCredentialId = '<copado__Org__c Id>';
req.requestType = 'GET';                 // GET/POST/PATCH/DELETE
req.endPointUrlService = '/services/data/vXX.0/query?q=...';   // path only; Copado supplies host+auth
copado.GlobalAPI.ProxyOrgResponse res = new copado.GlobalAPI().proxyOrgRequest(req);
// res.statusCode (Integer), res.content (String)
```
**Strategic consequence**: this is a cross-org READ (and write) seam that needs NO JWT
enrollment, NO RemoteSiteSetting, NO minted token -- for any org that already holds a Copado
credential. It sidesteps the whole "cross-org token minting proven impossible from Apex" wall
for the read path. Still bounded by the credential's 30-day validation recency like everything
else. A permission or metadata explorer can read a target org through this instead of the JWT leg
for any Copado-credentialed org.

**`copado.Jobs.DynamicExpression.evaluate`** -- resolves `{$...}` ConfigJson merge fields with
NO build/run. CONTEXT MUST BE A JobStep Id (a JobExecution Id errors "Didn't understand
relationship 'JobExecution__r'" -- the expression namespace is rooted at the step). Shape:
```apex
copado.Jobs.DynamicExpressionEvaluateRequest der =
    new copado.Jobs.DynamicExpressionEvaluateRequest('<JobStep Id>', new List<String>{ '{$...}' });
List<copado.Jobs.DynamicExpressionEvaluateResult> rs = copado.Jobs.DynamicExpression.evaluate(der);
// each: .dynamicExpression .value .isSensitive .errorMessage
```
Proven live: `{$Context.JobExecution__r.Name}` => `JE-1633`,
`{$Context.JobExecution__r.DataJson.environmentId}` => a real env id. **Cheaper CRT debugging**:
when a CRT run gets the wrong value injected, resolve the exact expression from the step's
ConfigJson from Apex in ~1s instead of firing a build to see what the engine produces --
turns a fire-watch-guess CRT cycle into a deterministic local lookup.
