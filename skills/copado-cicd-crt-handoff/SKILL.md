---
name: copado-cicd-crt-handoff
description: "A Copado Robotic Testing run is missing a variable / a variable was never injected / a parameter was never wired / a login URL arrives without a credential. Read what CI/CD actually handed the run, from the Salesforce records, in seconds instead of burning builds guessing. Also covers a variable arriving with the WRONG value, org enrollment failing with insufficient access, and a dead credential that arrives as a short login URL with no session in it. Explains the job record graph, the parameter mapping that turns configuration into run variables, why credentials travel as frontdoor session URLs and never as raw session ids, and a census keyword that lists every variable actually in scope instead of guessing names. The real reason a credential will or will not mint is validation recency, not its status."
license: MIT
compatibility: "Requires a Salesforce org with the Copado CI/CD managed package and a Copado Robotic Testing project. Diagnosis uses SOQL through the Salesforce CLI or Tooling API."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "copado-cicd"
---

# The Copado CI/CD → CRT handoff

Nobody documents this well, so it gets probed by trial and error — each attempt costing a CRT build
and minutes. **Almost all of it is readable from Apex in seconds**, because CI/CD's payload lives on
ordinary Salesforce records before it goes anywhere.

## Read it from Apex first. Always.

```apex
copado__JobExecution__c je = [
    SELECT Id, Name, copado__Source__c, copado__Destination__c,
           copado__DataJson__c, copado__Status__c
    FROM copado__JobExecution__c ORDER BY CreatedDate DESC LIMIT 1];
System.debug(je.copado__DataJson__c);

for (copado__JobStep__c st : [
        SELECT Name, copado__Type__c, copado__ConfigJson__c, copado__Order__c
        FROM copado__JobStep__c WHERE copado__JobExecution__c = :je.Id
        ORDER BY copado__Order__c]) {
    System.debug(st.Name + ' -> ' + st.copado__ConfigJson__c);
}
```

That answers "what is CI/CD about to send?" with no build, no CRT minutes, no waiting. A real CRT
run only answers the *other* question — "what actually landed in the VM" — and you rarely need it
until the first one looks right.

## The record graph

```
copado__JobTemplate__c        the reusable definition (ApiName__c, e.g. 'RunCrtTests')
  └── copado__JobStep__c      one per step, TEMPLATE-level, carries ConfigJson__c
copado__JobExecution__c       one run: Source__c, Destination__c, DataJson__c (the payload)
  └── copado__JobStep__c      the run's own steps, ConfigJson__c resolved per execution
```

**`ConfigJson__c` is the whole game.** It names a flow and lists the parameters that flow receives.
**Anything not in that parameter list does not reach the run**, no matter how well-populated it is
on the JobExecution.

Real `RunCrtTests` template, confirmed live:

```json
// step 1
{"flowName":"copadoQuality.SetSourceEnvironmentOnCrtJobExecution","parameters":[
  {"name":"jobExecutionId","value":"{$Context.JobExecution__r.Id}"},
  {"name":"testIds","value":"{$Context.JobExecution__r.DataJson.testIds}"},
  {"name":"environmentId","value":"{$Context.JobExecution__r.DataJson.environmentId}"}]}

// step 2
{"flowName":"copadoQuality.RunCrtTests","parameters":[
  {"name":"stepId","value":"{$context.Id}"},
  {"name":"sourceCredentialBaseUrl","value":"{$Source.Credential.Endpoint}"},
  {"name":"sourceCredentialSessionId","value":"{$Source.Credential.SessionId}"},
  {"name":"destinationCredentialBaseUrl","value":"{$Destination.Credential.Endpoint}"},
  {"name":"destinationCredentialSessionId","value":"{$Destination.Credential.SessionId}"}]}
```

Merge-field syntax: `{$Context.JobExecution__r.<field>}`, `{$Context.JobExecution__r.DataJson.<key>}`,
`{$Source.Credential.*}`, `{$Destination.Credential.*}`, `{$context.Id}` for the step itself.

## Two findings that cost hours to learn the slow way

### 1. Credentials arrive as a frontdoor `sid` inside `${loginUrl}` — there is no session variable

The four `*Credential*` parameters above are handed to `copadoQuality.RunCrtTests`, which **consumes
them and mints a frontdoor URL**. In the CRT VM you get one variable:

- `${loginUrl}` **without** a credential: ~44 chars, the plain instance URL (job configuration).
- `${loginUrl}` **with** one: ~222 chars, carrying `?sid=<token>`.

`sessionId`, `sourceCredentialSessionId`, `destinationCredentialSessionId` and friends are **never**
RF variables. Parse the URL instead:

```robot
${host}=       Get Regexp Matches    ${loginUrl}    (https://[^/]+)
${sid}=        Get Regexp Matches    ${loginUrl}    [?&]sid=([^&]+)    1
${session}=    Evaluate    urllib.parse.unquote($sid[0])    urllib.parse
```

Matches Copado's Dynamic Credentials doc: it builds a frontdoor URL from the OAuth token, and
**only the Destination credential is usable.**

### 2. `copado.RunTestsAction` CANNOT bind a Source — so no credential is ever minted

`RunTestsAction` leaves `copado__Source__c` and `copado__Destination__c` **null** even when
`DataJson.environmentId` is set and step 1 reports Success. No Source means no credential to
resolve, so `${loginUrl}` arrives as bare configuration.

Use instead:

```apex
Invocable.Action a = Invocable.Action.createCustomAction('apex', 'copado__CreateExecution');
a.setInvocationParameter('templateName', 'RunCrtTests');   // API NAME -- the label is rejected
a.setInvocationParameter('sourceId', envId);
a.setInvocationParameter('destinationId', envId);
a.setInvocationParameter('dataJson', payloadWithResultIds); // omit resultIds -> null dereference
// then copado__RunJob, or runAfterInstantiation: true
```

Use `Invocable.Action.createCustomAction` rather than a compile-time `copado.` reference, so your
package still installs where Copado CI/CD is absent.

## Getting your OWN data to the run

`DataJson.acceptanceCriteria` can be fully populated and still never reach the VM — because step 2's
parameter list does not include it. Confirmed live: a JobExecution carrying a complete request under
`acceptanceCriteria` produced `acceptanceCriteria: not injected` in the suite. **The channel is not
unreliable; the parameter was never wired.**

Options, cheapest first:

1. **Derive it instead of passing it.** Authenticate with the `sid` and ask the target org what it
   is (`SELECT Id FROM Organization`). No channel, no race across concurrent runs, and
   self-verifying — it proves the credential works rather than trusting a parameter.
2. **`files/upload` into the CRT job before dispatch.** Proven machinery; the suite reads a known
   filename. Watch concurrency: one file, many parallel executions.
3. **Add a parameter to the template's `ConfigJson__c`.** The JobStep rows are records and appear
   writable — but `RunCrtTests` is the **SHARED** template every CRT execution in the org uses.
   **Clone it to your own template rather than editing it in place**, and confirm the managed flow
   actually declares an input of that name first.

## The integration is NOT as limited as it looks — extend the TEMPLATE, not the CRT step

A widely-held belief on this project was that you cannot get your own data through CI/CD into a
CRT run. That is true of the CRT step and false of the template.

| | Extensible? |
|---|---|
| `copadoQuality.RunCrtTests` step parameters | **No.** Managed flow, declared inputs. The four `*Credential*` params are CONSUMED (they become the frontdoor URL), not forwarded. An undeclared name would error, not arrive. |
| **Adding your own steps to a job template** | **Yes.** Arbitrary `functionName` plus an arbitrary named parameter list, including literal content. |

A real `Function` step, read from a live record:

```json
{"functionName":"sfdx_execute_apex","parameters":[
  {"name":"script","value":"delete [SELECT Id FROM Account WHERE Name = 'Example Account'];"},
  {"name":"destination_sessionid","value":"{$Destination.Credential.SessionId}"},
  {"name":"destination_endpoint","value":"{$Destination.Credential.Endpoint}"},
  {"name":"destination_env_var","value":"{$Destination.apex.EnvironmentVariables}"},
  {"name":"isValidation","value":"{$Context.JobExecution__r...}"}]}
```

Step types in use: **Flow**, **Function**, **Test**, **Manual**.

**The pattern this unlocks:** add a Function step BEFORE the CRT test step that writes whatever the
suite needs into the CRT job — a file via `files/upload`, or a job variable — using the credentials
and `DataJson` values available to it as merge fields. The suite then just reads it. That is a
general channel into the VM that does not depend on the managed flow forwarding anything.

**Proven vs not:** the parameter shape and merge-field access above are read from real records.
That a Function step can WRITE into the CRT job is the sensible next step and is **NOT yet
proven** — it needs a custom function, or `sfdx_execute_apex` calling back out. Run one experiment
before relying on it.

**And do not edit a shared template in place.** `RunCrtTests` is used by every CRT execution in the
org; clone it.

## Census every variable instead of guessing names

Declaring candidate variables and reporting which are set can only ever find names somebody already
guessed. "sessionId was not injected" then really means *"the nine names I guessed were not set"* —
a much weaker claim that reads like the stronger one.

`Get Variables` returns the entire scope as a dict, so an unpredicted name shows up on its own. A
reusable `Report Variable Census` keyword belongs in your suite's `resources/common.robot`.

**Two traps it was built through:**

- **Do NOT write the variable-decoration characters as a literal string inside `Evaluate`.** Robot
  resolves `${}` *inside the string* before Python sees it, and the run dies with
  `Variable '${}' not found` pointing at nothing obvious. Use
  `$key.lstrip('$&@%').lstrip('{').rstrip('}')`.
- **Read values from the dict `Get Variables` returns**; a dynamic re-lookup like `${${name}}`
  breaks on Robot's own odd keys.

**A useful asymmetry for redaction:** a plain `Log` lands only in `log.html`, while
`Log ... console=True` also reaches the PACE `/logs` API. So one run can show a **human** real
values in the CRT log viewer while an **agent** reading the build log over the API sees only
lengths and prefixes — the value never enters an agent's context or a shared transcript.

## Related

`copado-cicd-object-model` (the wider CI/CD graph) · `crt-jwt-connected-app-provisioning` (JWT +
Connected App + v3 secrets) · the CRT build API reference (never print a
raw `/builds` response — they echo plaintext secrets).


---

## Whether a Copado credential can mint at all: RECENCY, not status

Established 2026-08-23 by two live enrollments that went differently.

**Neither obvious signal works.** Two credentials both had an OAuth signature and both read
`copado__Validated_Status__c = 'None'`; one enrolled cleanly and one could not start. What
separated them was `copado__Validated_Date__c` -- **2 days vs 2.5 years** -- consistent with
Copado's documented **30-day refresh-token inactivity TTL**. A credential nobody exercises goes
quietly dead while still LOOKING fine.

Measured across 273 credentials in one org: 16 validated within 30 days, 10 within 90, **164
older**, 83 never. Only 2 read status `OK` -- and note the valid value is **`OK`**, not `Valid`.

```apex
Integer days = (System.now().getTime() - org.copado__Validated_Date__c.getTime())
               / (1000L * 60 * 60 * 24);
Boolean likelyLive = days <= 30;   // best available predictor
```

**The dead-credential symptom is distinctive:** `${loginUrl}` arrives ~44 characters with **no
`sid=`** -- job configuration, not a credential. A live one is ~222 characters and carries the
frontdoor token. If you see the short form, stop looking at your code.

## Two failure modes, and only one is predictable

| | Symptom | Predictable? |
|---|---|---|
| **Dead credential** | 44-char `loginUrl`, no `sid` | **Yes** -- from validation recency |
| **Target org refuses** | `INSUFFICIENT_ACCESS: ... ModifyAllData or ModifyMetadata` | **No** -- only by attempting |

The second is decided by the **CI/CD credential's USER**, not by the session and not by whoever
clicked the button. A System Administrator succeeded where a Standard Platform User was refused on
both the External Client App and Connected App routes. It is not retryable until somebody grants a
permission in that org.

**Corollary worth stating plainly: the identity that installs the app, and the identity the target
org AUDITS, is the CI/CD credential's user.** Not the person who clicked Enroll.
