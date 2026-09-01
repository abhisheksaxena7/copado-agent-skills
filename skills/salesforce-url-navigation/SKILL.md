---
name: salesforce-url-navigation
description: "URL-first navigation in Salesforce: direct URL manipulation as the sole navigation mechanism for an AI or test agent, every verified URL form (records, list views, new/edit, tabs, apps, Setup, related lists), the host patterns for sandbox / scratch / production / Dev Edition / playground, frontdoor and impersonation URLs, and the silent-fallback traps that make a wrong URL look like a successful page load. Load before clicking through navigation, before writing any GoTo/OpenBrowser/navigate step, before building a Lightning app or Setup URL, before impersonating a user, and whenever a page loaded but shows the wrong thing. Triggers on \"navigate\", \"go to the record\", \"open Setup\", \"direct URL\", \"URL-first\", \"deep link\", \"lightning/r\", \"lightning/o\", \"lightning/app\", \"frontdoor\", \"servlet.su\", \"login as\", \"impersonate\", \"list view\", \"wrong app\", \"took me to my default app\"."
license: MIT
compatibility: "Requires a Salesforce org and a browser or test runner. SOQL examples assume Salesforce CLI or any REST client. No external services."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "salesforce-navigation"
---

# URL-first navigation in Salesforce

**The standing directive: direct URL manipulation is the sole navigation mechanism for an AI or
test agent.** Never click through the app menu, never use the nav bar, never "search and click the
result". Clicking is slow, order-dependent, and breaks whenever someone re-orders a tab; a URL is a
single deterministic step that states exactly where you meant to go.

**The one caveat that matters:** a direct URL bypasses **client-side nav-hiding** — it does NOT
bypass **CRUD or FLS**. If the user lacks Read on the object, the URL fails as it should. Reaching a
page by URL is never a permissions workaround, and if it looks like one, you have found a bug worth
reporting rather than using.

---

## The APP decides the record page — a bare object/record URL is ambiguous, not just less specific

**Measured 2026-09-01 on a sandbox:** Contact had an **empty** org-default FlexiPage, yet **7
different apps assigned 5 distinct pages** to it. A test that
navigates to a bare `/lightning/o/Contact/list` or `/lightning/r/Contact/<id>/view` — the forms
below, on their own — is asserting against an **undefined** page: which tabs exist, what's inside
them, is decided by whichever app the session happens to be in. **Always navigate inside an
explicit app context** (`/lightning/app/<06m DurableId>/o/<Object>/list`, or land on the app home
first) rather than a bare object/record URL, unless you have specifically verified only one app is
ever assigned to that object.

**The same rule, second key: RECORD TYPE on creation.** On an object
with record types, `/lightning/o/<Object>/new` alone is incomplete — what happens next is
org/profile-dependent: an RT-selection modal that **may not exist**, or a silent default-RT form
(wrong layout, wrong picklist values). Always append `?recordTypeId=<012…>` — the deterministic
create path — and remember the RT decides the create form's layout, its picklist value sets, and
its field defaults. A navigation contract for an AI or
test agent therefore carries **three context keys: app, record type (when the object has them),
and path** — omitting either of the first two produces a page that is *undefined*, not merely
default. Resolve record type ids at run time from `describe.recordTypeInfos` (or a cached copy of
it), never hardcode one.

Two REST facts (measured 2026-09-01) that make the record-type key cheap and honest:

- **`GET /sobjects/<Object>/describe/layouts`** answers the whole question in ONE call: every
  record type's `recordTypeId → layoutId` mapping, which one is the default, per-RT picklist
  values — and `recordTypeSelectorRequired`, the platform's OWN statement of whether a bare
  `/new` will demand a selection (no heuristic needed; note it arrives as a one-element list).
  `…/describe/layouts/<recordTypeId>` then returns that RT's fully resolved layout as JSON.
- **`available` in those mappings is per-USER.** A record type can exist, be active, and still
  be unavailable to the running user — navigating to its `?recordTypeId=` then fails with no
  useful error. Check `available` before composing the URL; zero available record types on a
  selector-required object means the form is unreachable for that user, which is a finding to
  report, not a retry.

## The URL forms that are verified in use here

| Goal | URL |
|---|---|
| A record | `/lightning/r/<Object>/<recordId>/view` |
| A record, edit modal | `/lightning/r/<Object>/<recordId>/edit` |
| A record, object omitted (works) | `/lightning/r/<recordId>/view` |
| Object list view | `/lightning/o/<Object>/list` |
| A **named** list view | `/lightning/o/<Object>/list?filterName=<Name>` (e.g. `Recent`, `__Recent`, `AllAccounts`, `All`) |
| New-record modal | `/lightning/o/<Object>/new` — **incomplete when the object has record types; see the context-keys rule above** |
| New-record, record type chosen | `/lightning/o/<Object>/new?recordTypeId=<012…>` — the only deterministic create path on an RT-bearing object |
| Custom tab / Lightning page | `/lightning/n/<TabApiName>` |
| App home | `/lightning/app/<06m DurableId>` — **see Trap 1** |
| Home | `/lightning/page/home` |
| The Lightning shell root | `/one/one.app` |
| Setup tree node | `/lightning/setup/<SetupNode>/home` |
| Classic escape hatch | `/<recordId>` (still redirects correctly) |

Custom objects use the same forms with the API name: `/lightning/o/copado__User_Story__c/list`,
`/lightning/r/My_Custom_Object__c/<id>/view`.


## Keep an org-specific URL map beside this skill

**This skill is the *rules and traps*. It is not the map.** The concrete URLs an individual org
needs -- each app's `06m` id, each console tab with its `c__tab`/`c__id` params, standalone tabs,
Copado `copado__` record pages, Setup nodes, flows and quick actions -- are org-specific and belong
in a document you keep next to your suite, regenerated when the org changes. Build every URL as
`${instance_url}` (from `GetInstanceUrl`) plus a relative path, and carry state in the query
string, so that map is a list of paths and never a list of hosts.

### More forms worth having in that map

| Goal | URL |
|---|---|
| Related list | `/lightning/r/<Object>/<Id>/related/<RelationshipName>/view` |
| New record with prefilled fields | `/lightning/o/<Object>/new?defaultFieldValues=Name=Acme,Industry=Retail` |
| Setup page for a specific record | `/lightning/setup/PermSets/page?address=%2F<Id>` |
| Setup, suppressing the redirect | `/lightning/setup/ManageUsers/page?address=%2F<Id>%3Fnoredirect%3D1` |
| A tab carrying state | `/lightning/n/<Tab>?c__tab=<name>&c__id=<recordId>` — read via `CurrentPageReference` |

**Cheap shape check before you trust a URL:**
```bash
sf org open -o <alias> --path <relative-path> --url-only
```
It builds `frontdoor.jsp?otp=…&startURL=<path>` and proves auth and shape — **not rendering**.
Assert rendering separately with `VerifyText <page title>`.

---

## Trap 1 — a Lightning app URL needs the **06m DurableId**, and the wrong one fails SILENTLY

> *"The app you are trying to view is invalid or inaccessible. We're taking you to your default app
> instead."*

**That message lies.** It says *inaccessible*; the usual cause is the wrong **identifier**, not
missing access. Measured on a sandbox (2026-08-28) for a user whose profile demonstrably grants the app:

| Identifier | Result |
|---|---|
| `/lightning/app/LightningSalesConsole` (DeveloperName) | **silently falls back** to the default app |
| `/lightning/app/02u…` (`AppMenuItem.ApplicationId`) | **silently falls back** |
| `/lightning/app/06m…` (`AppDefinition.DurableId`) | **lands correctly** |

Reached via `servlet.su`'s `retURL`, the fallback shows **no error at all** — you simply end up on
the default app, and a test that only asserts "a page loaded" passes. This was first misdiagnosed as
a profile-access problem; the disproof was that an app the profile *does* grant also fell back, so
access was never the variable.

**Resolve it inline, never hardcode:**
```sql
SELECT DurableId FROM AppDefinition WHERE Label = 'Sales Console' LIMIT 1
SELECT DurableId, Label, DeveloperName, NavType FROM AppDefinition WHERE NavType = 'Console'
```

## Trap 1b — `?app=` does NOTHING, the URL rewrites after a real switch, and app labels collide

Three measured facts (2026-09-01, live) about pinning and verifying the app context:

1. **The `?app=<name>` query parameter is a placebo.** Navigating
   `/lightning/r/<Object>/<id>/view?app=standard__LightningSales` leaves the session in whatever
   app it was already in — Lightning strips the parameter. Measured directly: pin app A by the
   path form, then navigate a record URL with `?app=` naming app B — the context bar still shows
   app A. AI assistants confidently recommend this parameter; it has no effect. The **path** form
   (`/lightning/app/<06m>/r/...`) is the only working pin.

2. **After a SUCCESSFUL app switch, Lightning rewrites the URL to the bare form** — the
   `/lightning/app/<06m>/` prefix disappears from the address bar. So verifying the landing by
   checking the URL for your app id **false-fails every correct switch**. The oracle is the DOM:
   read the app name from the context bar (`//*[contains(@class,'appName')]//span`) and compare
   to what you asked for. (This exact false-negative suppressed app navigation in one real
   project for weeks — every working switch was reported as a silent fallback.)

3. **App labels are not unique.** An org can carry a Classic "Sales" and a Lightning "Sales"
   simultaneously — same label, different `DurableId` and `UiType`. Resolve apps by
   `AppDefinition.DurableId` (filter `UiType = 'Lightning'` when you mean Lightning), and treat a
   label-matched context-bar read as *guarded* confirmation, never id-level proof.

## Trap 2 — `/` does NOT route a user to their own default app

Claimed from reasoning, then **measured false** on a sandbox. With `UserAppInfo.AppDefinitionId` set to a
genuine `NavType=Console` app, `retURL=%2F` still landed on a Standard-nav app — byte-identical to
the landing before the app was changed. `servlet.su` impersonation appears to resolve the landing
from the org/profile default and ignore the target user's `UserAppInfo` *(cause UNVERIFIED)*.

**So: if you need a specific app, name it with its `06m` id.** Do not rely on the org root.

Note the meta-lesson recorded alongside it: a first A/B proved nothing because every test step
navigated to an explicit URL immediately after impersonating, discarding the landing. **A landing
test must observe and then STOP.**

## Trap 3 — `frontdoor.jsp` returns **HTTP 200, not a 302**

Measured 2026-08-28. The hop is **client-side** — a `window.location` assignment plus meta refresh.

- **`curl` and `requests` will never follow it.** They get a 200 and an HTML page and look
  successful while establishing nothing. Frontdoor must run in a real browser, or you must parse the
  JS target yourself.
- The first 200 *does* set `sid`, `sid_Client`, `oid`, `clientSrc`. The JS hop then goes to
  `<org>.file.force.com/secur/contentDoor?startURL=…` which propagates the session to the content
  domain. Skipping it leaves you half-logged-in.

**`retURL` behaviour, measured:**

| `retURL` | Result |
|---|---|
| omitted | `/one/one.app` on the My Domain host |
| relative | honored, but resolved against `my.salesforce.com`, so Salesforce adds its own hop to `lightning.force.com` |
| absolute, org's own Lightning host | honored verbatim — **one redirect fewer, the fastest form** |
| absolute, foreign host | **HTTP 500** — rejected server-side, not silently dropped |

An unencoded `?` inside `retURL` survives **only while `retURL` is the last parameter**.

## A frontdoor URL is a live credential — never log it

`frontdoor.jsp?sid=…` / `?otp=…` carries a working session for whoever holds the string. Treat it
exactly like a password: **never print, log, echo or commit a frontdoor URL, a `sid`, or an `otp`**,
and never paste one into an agent transcript or an issue. Pass it as a run-time variable, keep it
out of screenshots, and let the keyword that consumes it do the navigating. The same rule covers
`servlet.su` URLs, which grant a session as another user.

## Trap 4 — frontdoor works only on the org's OWN host

| Host | Result |
|---|---|
| org's own `*.my.salesforce.com` | works |
| org's own `*.lightning.force.com` | works, identical |
| `test.salesforce.com` | **fails** — no cookie, bounced to `?ec=302&startURL=/home/home.jsp` |
| `login.salesforce.com` | **fails** — same |

**`sandbox=true` on `JWTAuthenticate` picks the token *audience* only.** It has nothing to do with
the frontdoor host, which is always the org's own My Domain. Conflating the two is why frontdoor
URLs get built against `test.salesforce.com` and hit a login wall.

`ec=302` means *"this session is not valid here"* — not *"the token is bad"*. Same signature as the
Experience Cloud community wall.

## Trap 5 — `servlet.su` needs BOTH `retURL` and `targetURL`

```
/servlet/servlet.su?oid=<orgId>&suorgadminid=<targetUserId>&retURL=<enc>&targetURL=<enc>
```

With only one of them the tab **parks on the `servlet.su` URL** and renders nothing useful. And the
`&` inside a nested `retURL` path must be **escaped**. In a CRT suite the same flow is available as an
impersonation keyword; build the URL exactly as above and let the keyword navigate it.


## Trap 6 — Setup lives on a DIFFERENT DOMAIN, and a normal session does not reach it

Measured live in a real browser on a sandbox, 2026-08-28.

Setup is not served from `my.salesforce.com` or `lightning.force.com`. With Enhanced Domains it
redirects to **`<mydomain>.my.salesforce-setup.com`** — a separate host. Consequences:

| How you got there | Result |
|---|---|
| `frontdoor.jsp?sid=…` then **direct navigation** to `/lightning/setup/<node>/home` | host stays `my.salesforce.com`, page renders **"Page not found"** |
| `frontdoor.jsp?sid=…&startURL=<encoded setup path>` | lands on **Home**, not Setup |
| `frontdoor.jsp?otp=…&startURL=<encoded setup path>` (what `sf org open --path` builds) | reaches `my.salesforce-setup.com` **and the right path** ✅ |

**So the reliable way to open a Setup page is to let the CLI build the URL:**

```bash
sf org open -o <alias> --path "/lightning/setup/ObjectManager/home" --url-only
```

The failure is nasty because **"Page not found" looks like a wrong node name and is actually a
domain/session problem.** Both hypotheses produce the identical page.

### And some node names genuinely are wrong — verify, do not trust a list

Same run, same mechanism (`otp` + `startURL`), four nodes:

| Node | Result |
|---|---|
| `ObjectManager/home` | **Object Manager** ✅ |
| `SetupOneHome/home` | Setup home ✅ |
| `PermSets/home` | **Page not found** ❌ |
| `ManageUsers/home` | **Page not found** ❌ |

A node list captured on one org marked `/lightning/setup/PermSets/home` as verified. On the org measured
here it is not. **Node names drift between releases and orgs — measure the one you need.**
*(Cause of the two failures not isolated: Setup access is demonstrably present, since ObjectManager
renders.)*

## Trap 7 — `defaultFieldValues` was stripped and did not prefill

Measured on the same sandbox, same run. Navigating to
`/lightning/o/Account/new?defaultFieldValues=Name=ProbeCo%20Ltd`:

- the New Account modal **did** open (title `New Account: Account`), and
- the URL was rewritten to `/lightning/o/Account/new?count=1`, and
- **no input carried the value** — the form came up empty.

So the page load is a green signal and the prefill silently did not happen. If you depend on
prefilled values, **read the field back** before asserting the state.

---

## Host patterns by environment

```
sandbox      <mydomain>--<sandbox>.sandbox.my.salesforce.com
scratch      <words>-<n>-dev-ed.scratch.my.salesforce.com
production   <mydomain>.my.salesforce.com
dev edition  <name>-dev-ed.develop.my.salesforce.com
playground   <words>-dev-ed.trailblaze.my.salesforce.com
```

Lightning host = same prefix with `.lightning.force.com`. Content host = `.file.force.com`.

**The path never changes between environments — only the host.** `sf org open --url-only` builds the
identical `/secur/frontdoor.jsp` path for sandbox, scratch and production. So an environment switch
is a hostname substitution, never a different navigation strategy. (Modern `sf` emits `otp=`/`cshc=`
rather than `sid=`; both reach the same place.)

**Never hardcode a host.** Take it from the token response (`instance_url`) — that is what
QForce's `JWTLogin` does, which is why it is automatically correct for every org type.

---

## In a CRT / Robot Framework suite

```robotframework
${token}=   JWTAuthenticate    ${client_id}    ${username}    ${private_key}    sandbox=true
JWTLogin    /lightning/o/Account/list?filterName=__Recent
```

`JWTLogin` takes **`ret_url` only** and derives the frontdoor host from the token response, so it is
correct for sandbox, scratch and production without a flag. If you need a host the default flow
cannot reach, `JWTAuthenticate` also accepts **`custom_url`** — and when given, `sandbox` is ignored.

For plain navigation inside an authenticated session, `GoTo <url>` is the whole story.

---

## How to get the ids a URL needs

```sql
-- a record, when the user names it
SELECT Id FROM Account WHERE Name = 'Acme' LIMIT 1
-- an app (06m — see Trap 1)
SELECT DurableId, Label, NavType FROM AppDefinition WHERE NavType = 'Console'
-- which apps a profile can see
SELECT SetupEntityId FROM SetupEntityAccess
 WHERE SetupEntityType = 'TabSet' AND Parent.Profile.Name = '<profile>'
-- a user's current default app
SELECT UserId, AppDefinitionId FROM UserAppInfo
```

`UserAppInfo` is createable, updateable **and deletable** via the API, so a default-app A/B is fully
reversible — capture the original `AppDefinitionId` first, change it, measure, restore, and **read
the restore back**.

---

## The rule underneath all of this

Every trap above has the same shape: **a wrong URL produces a plausible-looking page rather than an
error.** A wrong app id lands you on *an* app. A wrong `retURL` lands you *somewhere*. A frontdoor
call to the wrong host returns *200*. So:

**After navigating, assert what you actually reached — not that something loaded.** Read back the
app name, the record id in the URL, or a field only the intended page shows. That is the same
same read-back discipline you apply to field values, applied to navigation: after navigating,
verify WHERE you landed (the app name in the context bar, the record Id in the URL) against
what you asked for — a green page load proves nothing about being on the right page.
