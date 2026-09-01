---
name: copado-ai-dialogue-api
description: "Building Apex code to call Copado AI / sending a message to a Copado AI chat / needing the dialogue API spec / integrating Copado AI into a workflow. The confirmed API surface for Copado AI's stateful dialogue chat: create a dialogue, send a message, read the full transcript, tool-calling for record creation, and file attachment. Authentication uses a custom header rather than standard Bearer or Basic, which means a Named Credential that does NOT generate its own authorization header. The full machine-readable spec is served by the API itself; fetch it for any field not documented here. Hard lessons: a single-dialogue GET returns the FULL message transcript with no separate messages endpoint, tool_choice accepts only a small set of literal strings, and storing the transcript locally is wrong because this endpoint is the history source."
license: MIT
compatibility: "Requires a Copado AI account and API token, plus network access to the Copado AI API. Apex examples require a Salesforce org with a Named Credential."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "copado-ai"
---

# Copado AI dialogue API

Base host: `https://copadogpt-api.robotic.copado.com`. Auth: custom `X-Authorization` header
(NOT standard `Authorization: Bearer/Basic` -- a Named Credential needs
`generateAuthorizationHeader: false` + `allowMergeFieldsInHeader: true`; see the
`salesforce-named-credential-provisioning` skill). Full machine-readable spec always available live at
`GET /openapi.json` (discoverable because Copado AI's 404 body is FastAPI's default
`{"detail":"Not Found"}` shape) -- **when in doubt about a field/endpoint, refetch and read the
real spec rather than trusting this file's memory of it or guessing.**

## Hard lesson that motivated writing this down
Missed on a first pass: `GET /organizations/{org}/dialogues/{dialogue_id}` (the single-dialogue
GET, not the list) returns the **full embedded message transcript** in a `messages` array --
there is no separate `GET .../messages` endpoint (that path is POST-only, confirmed via a live
405). Don't build a redundant local transcript-storage mechanism assuming the history is
unrecoverable -- check the single-GET response fully first. Also missed on a first pass:
`tool_choice` only accepts the literal strings `'auto'`, `'any'`, `'tool'` -- NOT `'required'`
(OpenAI's convention) -- confirmed via a live 422 validation error listing the accepted literals.
General rule this skill exists to enforce: read the FULL response schema for every endpoint
(not just the one field you're looking for) before writing integration code, and when a live
call returns an unexpected 4xx, read its error body -- it often names the exact accepted values.

## Core resources
- `POST /organizations/{org}/dialogues` -- create. Body: `{name (required, <=100 chars),
  workspaceId (uuid, nullable), assistantId (string, nullable, defaults to "knowledge")}`.
  Response 201: `{id, name, workspace_id, message_count, document_count, assistant_id,
  created_at}`.
- `GET /organizations/{org}/dialogues` -- list dialogues. Takes a real, documented query param
  `?workspace_id={uuid}` to scope to one workspace (confirmed in the OpenAPI `parameters` array,
  and live: filtering by workspace on a real workspace returned 19 real dialogues, including ones
  created through Copado AI's own native web UI, not just ones a given integration itself
  created). **Use this as the actual history source for any chat UI, not a local tracking table.**
  A hard lesson from a real mistake: an earlier version of a chat widget tracked "my own
  dialogues" in a local Salesforce object and used THAT for the history picker -- it only ever
  showed 1 entry while the account's REAL history for that workspace (visible in Copado AI's own UI)
  had 19. A local tracking object only knows about what your OWN integration created; it can
  never see dialogues created any other way. If you need "dialogues associated with record X"
  specifically (not just "all dialogues in a workspace"), a local tracking object still has a
  place for THAT association -- but for a general history list, hit this endpoint directly.
- `GET /organizations/{org}/dialogues/{dialogue_id}` -- single dialogue, **includes the full
  `messages` array** (see below). This is the only way to read history back; use it to
  rehydrate a chat UI when reopening a past dialogue.
- `PATCH /organizations/{org}/dialogues/{dialogue_id}` -- rename ONLY (`{name}`). Cannot
  repoint `workspace_id` or `assistant_id` after creation -- a dialogue is bound to its
  workspace/knowledge-base for life. To "switch workspaces," start a new dialogue against
  the other workspace; offer that as a picker at NEW-dialogue time, not a live in-conversation
  switch.
- `DELETE /organizations/{org}/dialogues/{dialogue_id}`, `POST .../rollback` -- also exist,
  not yet exercised.
- `POST /organizations/{org}/dialogues/{dialogue_id}/messages` -- send. Body: `{request_id
  (uuid, required), prompt (required), dev_context, system_prompt, assistantId, integrations,
  tools, tool_choice, messages}` -- see "Sending a message" below for the important optional
  fields. Response is **streaming NDJSON** (Apex sees it as one whole string, no true
  streaming) -- see "Response event types" below.

## Message transcript shape (from the single-dialogue GET)
```
messages: [
  { role: "human", content: "<plain string>", timestamp, dialogueId, messageOffset,
    requestId, assistant, metadata: {...} },
  { role: "ai", content: [ { type: "text", text: "<chunk>", artifact: null }, ... ],
    timestamp, ..., metadata: { followups: [...], token_usage: {...}, ... } }
]
```
Human messages: `content` is a plain string. AI messages: `content` is a LIST of blocks --
join every block's `text` field in order to get the full reply. Don't assume either shape is
a plain string; branch on `content instanceof String` vs `instanceof List`.

## Sending a message -- real optional fields, all confirmed in the schema
- `assistantId` -- per-message agent override (same values as dialogue-create: `knowledge`
  (default), `plan`, `build`, `test`, `release`, `operate`, `generalist` -- these built-in
  agents map cleanly onto an agent-type picklist if you mirror them in Salesforce).
- `dev_context: {libraries: [string], functions: [ChatFunction], buffers: [DevBuffer]}` --
  `ChatFunction = {name, parameters: JSONSchemaObject, description}` is an alternate/older
  function-calling shape (compare to top-level `tools` below -- both exist in the schema,
  only `tools`/`tool_choice` has been live-tested so far). `DevBuffer = {name, content,
  description}` is a named free-text context blob -- exactly the mechanism for injecting
  "here's the record currently open + its related records" into a message for a
  troubleshooting-style assistant.
- `tools: [{type: "function", function: {name, description, parameters: JSONSchema}}]` +
  `tool_choice` (`'auto' | 'any' | 'tool'`, NOT `'required'`) -- real, live-tested OpenAI-style
  function calling. `'auto'` lets the model decide whether to call the tool or reply with text
  (e.g. a clarifying question if the ask is under-specified) -- prefer this for anything where
  a premature/fabricated tool call would be bad. `'any'` FORCES a tool call even on a vague
  prompt -- confirmed live it will fabricate a plausible-but-wrong answer rather than asking a
  clarifying question, so only use forced calling when the caller has already validated the
  request is fully specified.
- `messages` -- a raw override array. NOT how conversation history works day-to-day (the
  dialogue already remembers everything server-side); this is for edge cases, not the normal
  send path.
- `system_prompt`, `integrations` -- exist in the schema, not yet explored.

## Response event types (NDJSON, one JSON object per line)
Observed so far: `version`, `status` (progress text, e.g. "Warming up", "Crafting solution",
"Searching the knowledge base"), `standalone_question`, `token` (`{content}` -- concatenate
these in order for the plain-text reply), `tool_calls` (`{tool_calls: [{id, function: {name,
arguments (a JSON STRING, not an object -- deserialize it)}}]}`), `model_usage`, `hallucination`,
`followup` (suggested next questions), `performance`. Parse leniently: split on `\n`, skip blank
lines, `try/catch` each `JSON.deserializeUntyped` and ignore lines that don't parse or don't
match a known `type` -- the exact set of event types is not contractually documented anywhere,
just observed.

## Files/documents -- confirmed LIVE 2026-08-22, real upload mechanism built and working
`POST /organizations/{org}/dialogues/{dialogue_id}/documents` -- multipart, field name `file`.
Returns `{id, filename, size, created_at, ...}`. `GET` lists, `DELETE .../documents/{filename}`
removes one. Scoped to a single dialogue (not the workspace). **This endpoint REJECTS images**
-- confirmed live via a real 415: `"Unsupported file type 'png' ... File type must be one of:
robot, resource, csv, json, md, pdf, docx, txt, log, xml, cls, trigger, page, py, js, ts, rtxt,
html, css, yml, yaml, xlsx"`. Validate the extension client-side against this exact list before
attempting an upload, and route anything else (especially images) through the image pipeline
below instead of this endpoint.

## Real image/screenshot support -- confirmed LIVE 2026-08-22 (an earlier version of this doc
wrongly said images had no working path; corrected against a real, working
Robot Framework reference implementation). Two-step flow:
1. **Resize/register**: `POST /organizations/{org}/image` with `{"image_url": "data:image/png;
   base64,<raw base64>"}` (a full data URI works directly -- it is NOT limited to
   already-hosted http(s) URLs, despite how the field name reads). Returns `{"image_url":
   "data:image/jpeg;base64,<recompressed base64>"}` -- always re-encodes to JPEG, presumably for
   token efficiency. Use the RETURNED (resized) data URI in the next step, not the raw original.
2. **Send as a multimodal message**: the `prompt` field on `MessageCreate` is untyped in the
   OpenAPI schema (no `"type"` on it at all) but the runtime validator enforces a real
   `ChatMessage` union underneath (`str | ChatMessage | list[ChatMessage]`, learned from a live
   422 error's field-path text, since `ChatMessage` itself isn't a named schema in the spec).
   For an image, send `prompt` as a single object:
   ```json
   {"role": "user", "content": [
     {"type": "text", "text": "..."},
     {"type": "image", "image_url": {"url": "<the RESIZED data URI from step 1>"}}
   ]}
   ```
   **The exact shape matters and is a hybrid of two conventions** -- `type: "image"` (not
   `"image_url"`, ruling out pure OpenAI) but WITH a nested `image_url: {url: ...}` wrapper
   (ruling out pure Anthropic, which would use `type: "image", source: {type: "base64",
   media_type, data}`). Every other combination tried (flat `url` on the image block, pure
   OpenAI `type: "image_url"`, pure Anthropic `source` object) returned a **500** with the exact
   same unhelpful body every time (`"'NoneType' object has no attribute 'url'"`) -- notably NOT
   a 422 validation error, meaning the request shape was accepted by the schema but crashed a
   later code path expecting the nested `image_url.url` structure specifically. If a future
   attempt at this hits that same 500 with different content, that's the tell you have the
   wrong shape again, not a transient server issue.

Verified live end-to-end through the real deployed Apex (not just curl): sent a real test image
through this exact flow and got back a correct, real answer describing its content.

**Real Apex gotcha, general-purpose (not Copado-AI-specific) -- building a multipart body in
Apex is genuinely unreliable, don't hand-roll it there.** Apex's `Blob` type has no concatenation
operator. The naive fix -- base64-encode the text header, the file bytes, and the text footer
separately, then string-concatenate the three base64 strings -- only produces a valid combined
encoding if EVERY segment except the last has a byte length that's an exact multiple of 3 (base64
processes bytes in independent 3-byte windows; a segment with padding (`=`) in the middle of the
concatenated string breaks decoding). A header/footer you control CAN be padded to a multiple of
3, but the file body's length is arbitrary -- so this breaks for real files in general. The
correct fix: build the ENTIRE multipart body (header text + raw file bytes + footer text) as one
combined byte array in JAVASCRIPT (`Uint8Array` concatenation is trivial and always correct
there), base64-encode that whole thing client-side, and have Apex do nothing more than
`EncodingUtil.base64Decode(thatOneString)` and `req.setBodyAsBlob(...)` with the matching
`Content-Type: multipart/form-data; boundary=...` header. Verified live: replicated the exact JS
byte-construction logic in Python, sent it through this exact Apex relay pattern, and confirmed
via a direct `GET .../documents` that the uploaded file arrived with the correct filename and
exact original byte size (not corrupted).

## Agent worker sessions -- a DIFFERENT concept from assistantId, not yet explored
`POST /organizations/{org}/agents` -- body `{agent, integrations, dev_context, workspace_id,
dialogue_id}`, returns `{agent_worker_url, session_id, session_auth_key}`. This looks like a
separate, longer-lived "agent worker" session mechanism (possibly what backs Copado's own
Test Agent runs), distinct from picking `assistantId` on a dialogue/message. Relevant if
building a "Test Agent" style widget -- investigate live before assuming it works like the
dialogue endpoints.

## Workspaces (the knowledge-base / dataset container a dialogue is scoped to)
`GET/POST /organizations/{org}/workspaces`, `GET/PATCH/DELETE .../workspaces/{workspace_id}`,
`.../workspaces/{id}/datasets` (its knowledge base), `.../instructions` (system-prompt-style
org/workspace instructions, `PUT`/`PATCH`/`GET`). A dialogue's `workspace_id` is fixed at
creation (see PATCH note above) -- switching "projects" means starting a new dialogue against
a different `workspace_id`, discovered via `GET /workspaces`.

## Underlying model observed
`claude-sonnet-4-6` (as of 2026-08-22, via `model_usage` events) -- not guaranteed stable,
don't hardcode logic that depends on the specific model name.

## A dialogue is PERMANENTLY WEDGED by an unanswered tool call (found live 2026-08-23)

If a dialogue's last model turn is a **tool call that never received a tool result**, that
dialogue is dead. There is no client-side way to supply the missing result.

- Next send returns `400 "message at index N: Assistant tool use message must be followed by a
  tool result message"`.
- A plain follow-up carrying no `tools` at all returns `"Agent internal error"`.

**Consequence for design**: never offer a tool in a dialogue you still need to converse in. If a
turn might produce a tool call you cannot answer, run it in a **throwaway dialogue** and keep the
real conversation clean. This bit the escalation work for real: offering the structured
`request_human_input` tool in the step's own dialogue destroyed the exact conversation the human
was supposed to reply into -- and it only surfaced on RESUME, after the human had already spent
their time.

This joins the other permanent-wedge case already recorded: a dialogue whose transcript contains
`Agent internal error` turns keeps returning empty replies forever. **Both are unrecoverable —
cut a fresh dialogue; there is no repair.**

## Finding WHICH workspace is connected to a given Salesforce org

The **single-workspace GET** (`GET /organizations/{org}/workspaces/{id}` -- NOT the list) returns
an `integrations` array with real connection detail:

```json
{"type": "salesforce", "config": {"instance_url": "...", "org_type": "...", "org_id": "00D..."}}
```

That makes workspace selection **derivable instead of typed**: take the target Salesforce org id,
single-GET each workspace, and pick the one whose Salesforce integration points at it. Never make
a user paste a uuid, and never hardcode one in a class -- a workspace without the right
integration has no context and no CI/CD reach, and running a customer's prompts in a workspace
you own is a tenancy problem as well as a quality one.

Three things that will bite:
- **`level`**: integrations are `MEMBER` (workspace-bound) or `USER` (org-wide, `workspace_id:
  null`). The per-workspace document lists only MEMBER ones, so **`integrations: []` does NOT
  prove the workspace has no reach.** Check the org-level integrations list too.
- **`check-status`**: an integration can be present but dead (`"error"` -- "authentication is
  outdated. Please disconnect and reconnect it"). Surface that; do not let a step fail later.
- There is **no endpoint that lists your organizations** -- re-confirmed twice. Org id is
  necessarily user-supplied; only the workspace within it can be discovered.

## dev_context: two live-found rules that cost a round-trip each (2026-08-24)

1. **`dev_context` REQUIRES `libraries` and `functions` keys** even when unused — omitting them
   is a real 422 (`body.dev_context.libraries: Field required`). Always send
   `{"libraries": [], "functions": [], "buffers": [...]}`.
2. **`dev_context.buffers` are TURN-SCOPED.** The model reads them perfectly on the delivery turn
   and CANNOT see them one turn later (observed: it honestly refused to fabricate). For durable
   context, ALSO upload the same content as a dialogue **document** (`POST /dialogues/{id}/documents`,
   multipart) and name that document in the prompt — later turns then read it fine. This
   buffer-plus-document double delivery is the standard pattern for giving a dialogue context
   that must outlive one turn. A ~150-line curated document was quoted verbatim with no
   truncation; the "small curated inputs survive, big dumps don't" law stands.

Also: an unanswered tool call permanently wedges a dialogue — if a send with `tools` is rejected
or abandoned, continue in a FRESH dialogue carrying the transcript, don't retry into the wedged one.

## Workspace instructions PUT: 5000-char SILENT cap (2026-08-24)

`PUT .../instructions` with a body over 5000 chars returns no visible error and leaves the OLD
instructions live. Only a read-back caught it. Always round-trip-verify every write on this API
(GET after PUT, compare byte-identical), and length-guard before sending. Also note there are
MULTIPLE workspaces with different instruction sets (general vs failure-analysis) -- confirm the
workspace id belongs to the instruction set you are replacing before any PUT.
