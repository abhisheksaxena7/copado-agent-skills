---
name: salesforce-apex-test-patterns
description: "Test passes but the bug ships / coverage is high but the feature is broken / tests pass vacuously when the org does not have a given object yet / data processing succeeds with WRONG values. The two rules learned the hard way: never assert on the absence of org state; for any path that can succeed with wrong data, assert on the VALUE returned. Also a runAs harness for permission-context coverage (not just admins), HttpCalloutMock pinned to real responses, the Mixed DML trap that breaks runAs, and why runAs does not enforce @AuraEnabled class access. Use when tests have high coverage but miss bugs, when adding permission-context or REST-resource tests, when mocking callouts, or when a deploy fails on the 75% coverage gate."
license: MIT
compatibility: "Requires a Salesforce org and Apex deployment tooling (Salesforce CLI or equivalent). No external services."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "salesforce-apex"
---

# Apex test patterns that catch real bugs

Coverage percentage is a deploy gate, not a quality signal. Salesforce says so itself: *"don't
focus on the percentage of code that is covered. Instead, make sure that every use case of your
application is covered."* These are the patterns that make tests catch things.

## The two rules learned the hard way

### 1. NEVER assert on the absence of org state

This has broken real test suites twice. Both looked reasonable when written:

```apex
// BROKEN: passes only until somebody legitimately creates the certificate
Assert.isTrue(result.contains('No certificate named'), 'Should report missing cert');

// BROKEN: passes only until the class exists
Assert.isNull(Type.forName('MyResponder'), 'Responder should not exist yet');
```

Both tests encoded "this org does not have X yet" as if it were behaviour. The moment X was
created — correctly, as part of the feature — the tests failed and looked like regressions.

**Assert on behaviour instead:** given a credential with no certificate, the service returns a
specific error; given a responder, it dispatches. Set up the precondition inside the test rather
than depending on the org not having it.

### 2. For any path that can succeed with WRONG data, assert on the value

The dominant bug family in data-processing Apex is not "it threw" — it is **"it reported success
and produced garbage."** Real examples:

- A bulk API reporting `JobComplete` when every row was rejected.
- `ORDER BY` on a parent field silently returning 25 of 115 rows.
- A `COUNT()` total clobbered to 0 when the record list came back empty.
- A `LIMIT 1` on a non-unique filter picking an arbitrary row.

A test asserting only "no exception thrown" catches **none** of these. So:

> Every path that can succeed with wrong data needs a test that supplies the degenerate input and
> asserts on the **value**.

The degenerate inputs worth a fixture every time: empty result set, all-items-failed, partial
failure, zero-length collection, a missing key mid-path, and **one-more-than-one** where the code
assumes exactly one.

## The runAs harness — permission-context coverage

Salesforce lists "Restricted user" as one of its five things-to-test, and it is the most commonly
skipped. If your code only ever runs as a System Administrator in tests, you are not testing
`with sharing`, FLS, CRUD checks, or Apex class access at all — an admin bypasses them.

This matters most for **REST resources and controllers behind a permission set**: they work in
production only because the running user happens to be an admin, and nothing warns you.

```apex
@IsTest
static void restrictedUserCanReachTheBroker() {
    User u = buildUserWithPermSet('MyApp_Admin');

    System.runAs(u) {
        Test.startTest();
        MyBrokerResource.Result r = MyBrokerResource.doWork(validInput());
        Test.stopTest();

        Assert.isTrue(r.success, 'A user holding only MyApp_Admin must be able to run this. '
            + 'If this fails, the permission set is missing an Apex class grant.');
    }
}

@IsTest
static void userWithoutThePermSetIsRefusedWithARealMessage() {
    User u = buildUserWithNoPermSets();

    System.runAs(u) {
        // The point: a REAL refusal, not a NullPointerException or a bare platform error.
        try {
            MyBrokerResource.doWork(validInput());
            Assert.fail('Expected a refusal.');
        } catch (Exception e) {
            Assert.isTrue(e.getMessage().contains('not permitted'),
                'Refusal must explain itself, got: ' + e.getMessage());
        }
    }
}
```

### CRITICAL: `runAs` does NOT switch Apex class access

**Corrected 2026-08-23, after writing the wrong thing here first.** `System.runAs` switches CRUD,
FLS and record sharing. It does **not** enforce `classAccesses` — that is checked by the
Aura/LWC/REST entry layer, never on an Apex-to-Apex call, which is all a test can make. A `runAs`
test calling a controller **passes with the class grant deleted**.

So "one test per granted class, each failing if its grant is removed" is NOT achievable, and
believing it produces a suite that proves nothing while looking thorough.

**Cover grants with a metadata test instead** — read the deployed `ApexClass.Body`, derive the real
entry points (`@RestResource`, or `@AuraEnabled` on a **static method** — occurrences on inner-class
DTO properties are not entry points), and assert each has a `SetupEntityAccess` row. That fails both
ways: a removed grant, or a new controller nobody granted.

**And a rule the harness must follow:** a permission test must **call the production class**, never
issue the query itself. Plain SOQL inside a test class does not reliably enforce CRUD — the same
query was observed refused inside a `with sharing` production class and returning rows inside the
test, for the same user in the same transaction. A test that queries directly proves nothing about
what the app does.

Use `runAs` for what it genuinely covers: CRUD, FLS, sharing, and whether a refusal produces a real
message instead of a null-pointer.

### The Mixed DML trap that breaks runAs tests

Inserting a `User` (a setup object) and a custom object in the same transaction throws
`MIXED_DML_OPERATION`. This bites almost every first attempt at a `runAs` test.

The fix: create the user inside its **own** `System.runAs` block, then do the data DML outside it.

```apex
static User buildUserWithPermSet(String permSetName) {
    User u;
    // Setup-object DML isolated in its own runAs -- this is what avoids MIXED_DML_OPERATION.
    System.runAs(new User(Id = UserInfo.getUserId())) {
        u = new User(
            Alias = 'tst', Email = 'test@example.invalid',
            EmailEncodingKey = 'UTF-8', LastName = 'Tester', LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US', TimeZoneSidKey = 'America/Los_Angeles',
            ProfileId = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1].Id,
            UserName = 'test' + DateTime.now().getTime() + '@example.invalid'
        );
        insert u;
        PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = :permSetName LIMIT 1];
        insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);
    }
    return u;
}
```

Note `UserName` must be globally unique across ALL Salesforce orgs — always suffix it with a
timestamp. Use a `.invalid` domain so it can never route real mail.

## Callout-heavy code: mock, but pin the mocks to reality

`HttpCalloutMock` is mandatory (tests cannot make real callouts), so this part usually gets done.
The failure mode is subtler: **a hand-written mock encodes what you BELIEVE the API returns.**
When the real shape drifts, the mock keeps passing and production breaks.

```apex
private class MultiLegMock implements HttpCalloutMock {
    // Real integrations are multi-leg (auth, then work). One mock, dispatching on the endpoint,
    // beats several mocks you have to swap.
    public HttpResponse respond(HttpRequest req) {
        HttpResponse res = new HttpResponse();
        res.setStatusCode(200);
        if (req.getEndpoint().contains('/oauth2/token')) {
            res.setBody('{"access_token":"tok","instance_url":"https://example.my.salesforce.com"}');
        } else if (req.getEndpoint().contains('/dialogues')) {
            res.setBody('{"id":"d1"}');
        } else {
            res.setStatusCode(404);
            res.setBody('{"detail":"Not Found"}');
        }
        return res;
    }
}
```

Two disciplines that keep mocks honest:

1. **Record real responses into static resources** rather than inventing bodies. Salesforce
   documents this (`Testing HTTP Callouts Using Static Resources`, `StaticResourceCalloutMock`).
   Add a dated provenance comment saying when and against what the body was captured.
2. **Test the error legs, not just 200.** 401 (does it re-mint and retry?), 404, a malformed body,
   and a body missing the field you index into. Error paths are where untested callout code fails.

Also test **callout-after-DML**: a method that does DML then a callout throws
`CalloutException` at runtime but often passes a naive test. If a service is designed to do no DML
before its callout (deferring writes to a later `stampResults()`-style method), write a test that
would fail if someone adds DML back in.

## Practical mechanics

- **`Test.startTest()` / `stopTest()`** give a fresh set of governor limits, so setup data creation
  doesn't consume the limits you are actually testing. Create all test data BEFORE `startTest()`.
  They also force async work (`@future`, Queueable, Batch) to complete at `stopTest()` — which is
  the only way to assert on a Queueable's results.
- **`@TestSetup`** runs once per class and rolls back between methods. Use it for shared fixtures;
  it is meaningfully faster than rebuilding data per method.
- **`@TestVisible`** exposes private members to tests without making them public API. Prefer it
  over widening real visibility.
- **Bulk at 200.** Salesforce explicitly asks for at least 20; 200 is the governor boundary that
  actually finds SOQL-in-loop and DML-in-loop bugs. Any method taking a collection needs one.
- **Never `@IsTest(SeeAllData=true)`** — it couples the test to org data and is the single biggest
  source of "passes on my org, fails on theirs."
- **Ternaries count as branches.** Salesforce does not consider a conditional executed unless both
  branches run.

## Running them

```bash
# One class, human-readable
sf apex run test --tests MyClassTest --target-org <alias> --result-format human --wait 30

# Several, which is what a deploy gate needs
sf apex run test --tests ATest --tests BTest --target-org <alias> --result-format human --wait 30

# Deploy running only the relevant tests (much faster than the default full run)
sf project deploy start --target-org <alias> --test-level RunSpecifiedTests --tests MyClassTest
```

Coverage is **org-wide 75%** for a production deploy, and every trigger needs some. `System.debug`
lines and test classes themselves don't count toward it. A deploy that fails at, say, 74.8% is
usually one new uncovered branch — find it rather than padding an unrelated class.

## Auditing an existing suite

These greps give a fast, honest picture of where a suite is blind:

```bash
cd force-app/main/default/classes
T=$(ls *Test.cls | wc -l)
echo "runAs:        $(grep -l 'System.runAs' *Test.cls | wc -l)/$T   # usually the big gap"
echo "startTest:    $(grep -l 'Test.startTest' *Test.cls | wc -l)/$T"
echo "CalloutMock:  $(grep -l 'HttpCalloutMock' *Test.cls | wc -l)/$T"
echo "SeeAllData:   $(grep -l 'SeeAllData=true' *Test.cls | wc -l)/$T   # must be 0"
echo "assertions:   $(grep -ch 'Assert\.\|System.assert' *Test.cls | awk '{s+=$1} END {print s}')"
```

Then count assertion-free test methods — methods that exist only to move the coverage number.
A healthy suite has a median of ~3 assertions per test and almost no zero-assertion methods.

## The permission-harness pattern: metadata tests that stop silent lockouts (2026-08-24)

A missing `classAccesses` grant on an @AuraEnabled class fails at CALL time with a bare "no
access" error — never at deploy time — and is invisible while every tester is a System
Administrator (admins bypass class access). The countermeasure that has now caught real gaps
twice: **a test class that queries the org's own security metadata and asserts the grants exist.**

```apex
// For every @AuraEnabled entry-point class, assert a SetupEntityAccess row ties it
// to the app's permission set. Runs as part of the normal suite: a developer who
// adds a controller but forgets the permset grant gets a RED TEST, not a support ticket.
Set<Id> granted = new Map<Id, SetupEntityAccess>([
    SELECT SetupEntityId FROM SetupEntityAccess
    WHERE ParentId IN (SELECT Id FROM PermissionSet WHERE Name = 'App_Admin')
]).keySet();
```

Count carefully what needs a grant: classes with @AuraEnabled on STATIC METHODS need one;
classes whose only @AuraEnabled markers sit on inner-class DTO PROPERTIES do not (they are
return types, not entry points). Counting raw `@AuraEnabled` occurrences gives the wrong list.

The same harness style deliberately PINS known-bad state: a test asserting the current
too-broad `modifyAllRecords` behaviour means removing it later fails loudly and forces the
design conversation instead of silently changing semantics. Assert what IS, so changes are
always intentional.

## Regression baseline before UI/metadata work, and reading suite results in a shared org

Before touching a live org's UI/metadata surface, run the full local suite once
(`sf apex run test --test-level RunLocalTests`) and record the per-namespace picture. In a
shared demo org the org-wide outcome can be "Failed" from OTHER teams' broken tests
(pre-existing cruft) while your own namespace is 100% green — grep the results by your class
prefix and judge on that, but keep the org-wide failures listed so nobody later mistakes them
for regressions you introduced.

## RunSpecifiedTests enforces 75% PER CLASS, not org-wide (2026-08-24)

A targeted deploy with RunSpecifiedTests gates on each deployed class individually hitting 75%.
A hard-to-cover block (e.g. a dispatcher fronting a managed-package Invocable) can block the
whole deploy. Two techniques that solved it: (1) probe fixture insertability first with
savepoint-ROLLED-BACK anonymous Apex (zero-cost check that managed objects accept test inserts);
(2) test the dispatcher with an INVARIANT ("never reports success without a job id") rather than
asserting a managed-package-version-dependent verdict. Also: mock callout datetimes at GMT NOON
so date-boundary assertions are timezone-proof.

## Learned from the 2026-08-25 head-to-head run (live, both lanes)
- `static can only be used on methods of a top level type` — no static methods inside inner classes.
- `AuraHandledException.getMessage()` is empty in tests unless the thrower calls `setMessage()`; wrap the whole controller body in the try.
- **Criteria-based sharing-rule shares are NOT visible to `System.runAs` for records created inside the test transaction** (ownership/manual shares are). Prove the rule live with `UserRecordAccess` (`SELECT RecordId, HasReadAccess, HasEditAccess FROM UserRecordAccess WHERE UserId = :u AND RecordId = :id`) or `SeeAllData=true` against a committed record; in-test, use a manual share for the deterministic half.
- `EventBus.publish` counts as a DML statement (adjust `Limits.getDmlStatements()` expectations); deliver with `Test.getEventBus().deliver()` inside start/stopTest.
- A read-only user's update surfaces as `System.TypeException: DML operation UPDATE not allowed`, not `DmlException` — `catch (Exception e)`.
- Org `CronTrigger` rows are visible to tests without `SeeAllData` — assert scheduled-job counts as ranges, not exact.
- `sf apex run test`: pass a Bash timeout ≥ 15 min (`--wait 15`); a timed-out run re-run gives `ALREADY_IN_PROCESS` — poll `ApexTestQueueItem` / `sf apex get test --test-run-id`, or abort the stale queue item via Tooling. `--synchronous` accepts exactly one class. `ApexCodeCoverageAggregate` is reset by later partial runs — re-run with `--code-coverage` before trusting a number.
