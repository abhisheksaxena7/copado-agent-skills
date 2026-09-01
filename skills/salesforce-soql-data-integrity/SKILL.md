---
name: salesforce-soql-data-integrity
description: "A SOQL query returns fewer rows than the object actually has, and nothing reports an error. ORDER BY on a parent field silently drops every row whose parent reference is null; a filter on a formula or roll-up behaves differently from the same filter on a stored field; a LIMIT hides the truncation. The rule: any query whose result feeds a count, a report, a migration, or an assertion gets its row count reconciled against an unordered, unfiltered COUNT() before you trust it. Use when a query result looks plausible but small, before quoting a number from a query to anyone, when writing a data-migration extract, and when a test asserts on query results."
license: MIT
compatibility: "Requires a Salesforce org and any SOQL client (Salesforce CLI, REST, or Apex). No external services."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "salesforce-data"
---

# Queries and data APIs that lie

The dangerous Salesforce data bugs are not the ones that throw. They are the ones that return a
plausible, smaller, or subtly wrong answer with a success status. They survive code review
because the output looks reasonable.

Every item here was confirmed live against a real org.

## ORDER BY a parent field on setup objects silently drops rows

On **setup objects** — `ObjectPermissions`, `FieldPermissions` and their siblings — adding
`ORDER BY` on a **parent-relationship field** silently returns far fewer rows. No error, no
warning, no truncation flag.

```
SELECT COUNT() FROM ObjectPermissions WHERE SobjectType='Account'
  -> 115

SELECT Id FROM ObjectPermissions WHERE SobjectType='Account' ORDER BY Parent.Label
  -> 25
```

Identical via Apex SOQL and via the REST API, so it is platform-side, not a client artifact.

**Real damage:** a Permission Explorer shipped showing **25 of 115** grants and an FLS matrix with
1 column instead of 2. It looked entirely plausible, which is exactly why it survived review.

**Apply:**
- Never `ORDER BY` a parent/relationship field on setup objects. Query unordered, then **sort in
  Apex over the full result set.**
- Any query with both a filter and an `ORDER BY` on a related field: sanity-check it against the
  same query with `COUNT()` and no ordering. A mismatch means rows are vanishing.
- **If a result set feels small, re-run it without `ORDER BY` before trusting it.**

## COUNT() totalSize gets clobbered when records is empty

A `COUNT()` query returns a real `totalSize` with an **empty** `records` array. Post-processing
that recomputes `totalSize` from the record list destroys it:

```python
# BROKEN: "records" is present but empty, so this rewrites a real 137 to 0
if "records" in value:
    value["records"] = value["records"][:max_records]
    value["totalSize"] = len(value["records"])

# CORRECT: an empty list is falsy -- nothing to truncate, so don't touch it
if value.get("records"):
    ...
```

This exact bug appeared **twice** in one codebase, at two different layers — fixed in the query
helper, then resurfaced in an unrelated `maxRecords` post-processor. When you fix a
"records-empty" bug, grep for every other place that reads `records` and writes `totalSize`.

## Bulk API 2.0 reports JobComplete when EVERY row was rejected

`state: "JobComplete"` means *the job finished running*, *not* that the data landed. A job where
all 500 records were rejected still reports `JobComplete`. Row-level outcomes live in a separate
`failedResults` fetch.

```python
# Never treat JobComplete as success. Fetch the counts.
if failed and not allow_partial_failure:
    raise RuntimeError(
        f"Bulk {action} on {sobject}: {failed} of {total} record(s) FAILED "
        f"(job {job_id}) -- {first_error}"
    )
```

Always surface the **first real org error text** (e.g.
`INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST`), not just a count — the count tells you something
broke, the text tells you what.

Same shape applies to the **Composite** and **Composite Graph** APIs: a 200 on the envelope says
nothing about the sub-requests. Iterate them and check each `httpStatusCode`.

## LIMIT 1 on a non-unique filter picks arbitrarily

```apex
// If two credentials exist for this org, this silently picks whichever sorts first.
SELECT Id FROM My_Credential__c WHERE Org_Id__c = :orgId LIMIT 1
```

Nothing errors. The wrong record is used, forever, invisibly. Whenever you write `LIMIT 1`, ask
what happens when the filter matches two rows. Three honest options:

1. **Enforce uniqueness** — make the field Unique / an External Id, so the ambiguity cannot exist.
2. **Order deterministically** and document why that order is correct.
3. **Query without `LIMIT` and refuse when the count is not 1**, with an error naming the
   candidates. This is right whenever picking wrong is worse than failing.

Refusing beats guessing for anything security- or credential-adjacent.

## Query results carry `attributes` that break serialization

Every SOQL record from the REST API carries an `attributes` object (`type`, `url`), including
inside **nested relationship objects and subquery `records`**. Passing these straight into a
comparison, a CSV writer, or another API call produces junk columns and false diffs.

Strip it **recursively**, not just at the top level — top-level-only stripping is a real bug that
shipped and had to be fixed.

## Governor-limit shapes that corrupt rather than throw

- **SOQL/DML in a loop** usually throws — good, it is visible.
- **`Database.insert(records, false)`** (allOrNone = false) does *not* throw on partial failure.
  It returns `SaveResult[]` and silently persists whatever succeeded. Always iterate the results
  and inspect `isSuccess()`; this is the Apex twin of the Bulk `JobComplete` trap.
- **50,000-row query cap**: `[SELECT ...]` throws past the limit, but a `QueryLocator` in a batch
  silently gives you what fits per chunk. Know which you are using.

## The general habit

For any code path that can succeed with the wrong data:

> Supply the degenerate input — empty result set, all-rows-failed, partial failure, zero-length
> collection, two rows where the code assumes one — and assert on the **value**, not on the
> absence of an exception.

A test asserting "no exception thrown" catches none of the bugs on this page. See
`sf-apex-test-patterns` for how to write those fixtures.


## A remote query is a GET -- a big IN list becomes HTTP 414

Salesforce's REST query endpoint has **no POST form**, so the SOQL travels URL-encoded in the URL.
An unbounded `IN` list overflows it and the org answers `HTTP ERROR 414 URI Too Long` against
`/badMessage`, which looks nothing like a query problem.

Measured 2026-08-23: `WHERE ParentId IN (985 ids)` is roughly **21,000 characters** before
encoding. **Chunk at ~200 ids** (~4 KB encoded).

**Look for the 414 in the query you did not write.** In that case the caller passed
`permSetNames = null`, so there was NO name filter at all -- the overflow was in a downstream GRANT
query built from the ids that the first query returned. Two "fixes" were applied to the name list
before anyone read the actual failing URL.

## Chunking fixes the URL, not the CPU

Beware treating 414 and CPU limits as the same problem. Same session, same feature: with the 414
fixed, comparing permission sets across two orgs still died. Measured -- 5 sets 3.4s, 15 -> 6.1s,
25 -> 9.8s, **40 -> Apex CPU limit exceeded**.

The cost was deserializing every record and every child grant from BOTH orgs, which happens
**before** any comparison, so no chunk size helps. **When the cost is in fetching rather than in
the query shape, the answer is asynchronous capture** -- snapshot each side separately, store it,
compare stored results. That also buys N-way comparison and pagination for free.

**And a fixed row cap is the wrong control** when cost scales with something else. Capping
"permission sets" looked reasonable, but cost actually scales with GRANTS PER SET -- so the same
cap is safe in a small org and fatal in a heavily-developed one. Watch `Limits.getCpuTime()`
against `Limits.getLimitCpuTime()` and degrade to a **labelled partial** instead.

## EntityDefinition: filters that lie, and the 6MB describeGlobal wall (2026-08-24)

Querying another org's schema from Apex: `/sobjects/` (describeGlobal) on a real production-size
org exceeds Apex's 6MB callout response cap — inventory must come from an `EntityDefinition`
query instead. But EntityDefinition is not a normal table: `WHERE IsCustomizable = true` IS
honored, while `LIKE` on `QualifiedApiName` is **silently ignored** (rows come back unfiltered,
no error). Filter by boolean/enum server-side, pattern-match client-side. Same genus as ORDER BY
on setup objects silently dropping rows: the query succeeds and the result is confidently wrong.
