---
name: copado-crt-pace-batch-trigger
description: "Fire many Copado Robotic Testing builds at once instead of one at a time / a data-table-driven run needs parallelism / you need a \"run all\" the UI does not expose / you want to override dataset values per run. Documents the batch build endpoint that accepts a JSON ARRAY body, one run per item, each carrying its own input parameters, and returning an array of build objects. Includes how to find a job's real dataset parameter keys from a prior build's execution parameters, the serial build-admission cost that decides whether parallelism will actually help, and a security warning: build responses echo execution parameters in plaintext, so filter to dataset-typed entries before logging or printing them."
license: MIT
compatibility: "Requires a Copado Robotic Testing project and a CRT API token. Network access to the CRT API is required; examples use curl or any HTTP client."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "copado-crt"
---

# CRT batch run trigger (undocumented, discovered 2026-08-21)

CRT's public PACE API spec (`https://api.pace.qentinel.com/pace/spec/`, real JSON buried in
`swagger-ui-init.js`) only documents a **single-run** trigger:
`POST /v4/projects/{projectId}/jobs/{jobId}/builds`, one `BuildBody` in, one build out. That
endpoint cannot fan out to multiple data-table rows in one call, and its `RunType` enum has no
"run all rows" option.

The CRT UI's own "Run Now" button (with "Auto-add all datasets" checked) does NOT loop 50 calls
against that endpoint client-side. It calls a **different, undocumented, project-scoped batch
endpoint** with a JSON array body. Found by injecting a `window.fetch` interceptor via
Claude-in-Chrome's `javascript_tool` before clicking "Run Now" in the real UI, then reading the
captured request via DevTools -- not discoverable from the public spec alone.

## The real endpoint

```
POST https://robotic.copado.com/pace/v4/projects/{projectId}/builds
Content-Type: application/json
X-Authorization: <raw PACE API token, no "Bearer" prefix>
```

Body is a **JSON array**, one object per run to trigger, each shaped like:

```json
[
  {
    "jobId": 198060,
    "inputParameters": [
      {"key": "parser_dataset_devdocs.partition_index", "type": "dataset", "value": "0"},
      {"key": "parser_dataset_devdocs.partition_total", "type": "dataset", "value": "50"},
      {"key": "parser_dataset_devdocs.max_articles", "type": "dataset", "value": "75"}
    ],
    "record": "none",
    "runType": "normal",
    "stream": false
  },
  { "jobId": 198060, "inputParameters": [ ... row 1 values ... ], "record": "none", "runType": "normal", "stream": false }
]
```

Response is a **JSON array** of the same length, each element a normal `BuildData` object (own
`id`, `status`, etc.) -- confirmed live 2026-08-21 (HTTP 201, two real builds created from a
2-item array, correct dataset values applied, verified via each build's own log line).

**Auth confirmed working with the plain PACE API token** (the same one used for every other v4
call, read from wherever you keep it, header `X-Authorization: <token>`) -- no browser
session cookies or CSRF token required, even though the browser's own request carries a full
cookie jar and `x-xsrf-token` header. Don't assume you need to replicate browser auth for this
endpoint; plain token auth works.

## Finding a job's real dataset parameter keys

Dataset-type input parameters follow `<dataTableName>.<columnName>` (e.g.
`parser_dataset_devdocs.partition_index`). To find them for a job you haven't triggered before:
read one existing build's `configuration.executionParameters`, filter to `type == "dataset"` only.

**Security -- do this every time, no exceptions**: `configuration.executionParameters` on ANY
build-related response (single build, builds-list, this batch endpoint's response, `RunData` from
the separate v5 `test-jobs` API) also carries the job's full secret store, and several
non-`sensitive`-flagged entries come back as **plaintext** (API keys, RSA private keys, client
secrets) -- confirmed leaking on multiple different endpoints across 2026-08-18 through 08-21.
Always filter to dataset-type entries (or drop `configuration` entirely)
before printing, logging, or displaying a response. Never pipe a raw response straight to
`json.tool` or the terminal.

## Why this matters

- **A curated subset of rows**, or custom per-row overrides, in one call -- something the UI
  itself doesn't support cleanly (its "Data Configuration" panel is either all-rows-auto-add, or
  one manually-configured run at a time).
- **Automating what looks like a UI-only "run all" action** -- e.g. driving a 50-partition,
  data-table-driven crawl/test round on a schedule or in a loop, without clicking through the UI
  each time. A real working example: trigger all 50 partitions with one
  call to this endpoint, poll each returned build id until terminal, merge results, re-prune the
  backlog, commit/push, repeat.
- Much cheaper than looping the documented single-run endpoint N times (fewer round-trips, one
  auth'd request instead of N).

## Data Tables (table content itself) -- a separate, cookie-only service

The batch endpoint above triggers runs against a data table's *existing* rows, but does not
create or edit the table's content. That's a genuinely different, separate microservice,
discovered the same way (fetch/XHR interception + DevTools "Copy" while a human drove the UI):

```
GET  https://test-data.robotic.copado.com/job-test-data?fields=id,name,topics,defaultRow,rowCount,colCount,jobId&projectId={projectId}
     -- lists all data tables for a project with metadata
POST https://test-data.robotic.copado.com/job-test-data?projectId={projectId}
     body: {"data": [[...header row...], [...value row...], ...], "name": "...", "topics": ["..."]}
     -- creates a new table, response {id, version, name}
PUT  https://test-data.robotic.copado.com/job-test-data/{tableId}?projectId={projectId}
     body: {"aiGenerated": false, "data": [[...header...], [...row1...], ...], "defaultRow": 1, "name": "...", "topics": [...]}
     -- overwrites a table's full content (row 0 = headers/column names), version increments each write
```

`data` is row-major: row 0 holds column headers, each subsequent row is one data row's values
(matches the `<tableName>.<columnName>` dataset-parameter key format used in the batch trigger
body above).

**Confirmed cookie/session-only, no bearer-token path found (2026-08-21)**: every call from the
real browser carries a full cookie jar (`FL`, `XSRF-TOKEN`, `sessionsToken`, `copa-token`, etc.)
plus an `x-xsrf-token` header -- no `X-Authorization` header at all. Tried against this host with
the plain PACE API token as `X-Authorization`, `Authorization: Bearer <token>`, and plain
`Authorization: <token>` -- all 401, same as no auth at all. Checked for a separate spec
(`/spec`, `/openapi.json`, `/api-docs`, `/swagger`, `/swagger.json`, `/docs`) -- all 404. The
documented PACE spec's `servers` list (the four regional `api.*-robotic.copado.com/pace` hosts)
doesn't include this host either -- it's a genuinely separate, undocumented microservice.
**Don't assume a stored API key can reach it** -- unlike the batch builds endpoint, this one
currently requires live browser session cookies to call at all, which is fragile (they expire)
and a different trust boundary than a long-lived API key. If this needs automating later, that's
the open problem to solve (e.g. finding a real API-key auth path, or a documented alternative)
rather than assuming the cookie-replay approach is a good idea to build on.

## What this does NOT do

- Does not replace the single-run endpoint for genuinely one-off triggers -- use
  `/jobs/{jobId}/builds` for that, it's documented and simpler.
- Does not expose a way to read a job's stored data table directly via API (only inferred by
  reading a build's dataset-type parameters after the fact, or via the CRT UI's Data Tables page).
- Unconfirmed whether this endpoint has its own rate limit or a max array size -- tested only up
  to a handful of items so far. Scale up gradually and watch for errors before assuming an
  arbitrary array size (e.g. hundreds) works cleanly.
