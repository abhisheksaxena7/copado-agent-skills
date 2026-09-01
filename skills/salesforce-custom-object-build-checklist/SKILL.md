---
name: salesforce-custom-object-build-checklist
description: "Each step deployed successfully but the object is still broken / field invisible after deploy / LWC deployed but not showing up / quick actions appearing that should not / related list will not save / record-type modal broken. An ordered checklist: object and fields, then field-level security before assuming usability, list views, layout with the correct related-list syntax, an explicit quickActionList even when empty, tabs and app and permission-set visibility, then the LWC FlexiPage and its org-default activation. Every step reported success in isolation and the result was still missing. Also covers Layout redeploys after Name-field type changes, why a double hyphen is illegal in XML comments, stale LWC module caching, compact layouts on record pages, and related lists on FlexiPages. Use whenever building a custom object people will actually see."
license: MIT
compatibility: "Requires a Salesforce org and Metadata API deployment tooling (Salesforce CLI or equivalent). No external services."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "salesforce-metadata"
---

# Building a real, usable custom object: the full checklist

Every step below deployed with `success: true` in isolation while building a real custom data
model -- and the object was still broken, invisible,
or wrong in the UI until the NEXT step was also done. None of these failures were loud; each
looked like "it worked" until actually checked. Do the whole list, in order, every time.

1. **Object + fields.** Standard `.object-meta.xml` + `fields/*.field-meta.xml`. Real gotcha:
   **`relationshipName` must be unique PER CHILD OBJECT, even across fields pointing at
   different parents.** Two lookup/master-detail fields on the same child object cannot share a
   `relationshipName` value -- it's silently accepted at field-deploy time and breaks later (a
   Layout's related list on one of the parents fails with "Cannot find related list", pointing
   at the WRONG field, not the one actually misconfigured). Give every relationship a distinct
   name up front.

2. **Permission Set for FLS -- immediately, not as an afterthought.** Salesforce grants ZERO
   Field-Level Security to any profile by default on new custom fields (Master-Detail fields are
   the one exception -- always visible, no FLS needed, and can't even RECEIVE an explicit
   `fieldPermissions` entry). Nothing errors; `sobject describe` just silently omits every
   ordinary field and record create/edit can't see them. See the
   `salesforce-permission-set-provisioning` skill for the full recipe. Do this right after step 1, before assuming the object is usable at all.

3. **List Views.** Deploying an object gives it "Recently Viewed" only -- there is no "All X"
   view until you explicitly add one (`objects/<Object>/listViews/All.listView-meta.xml`).

4. **Page Layout, with the related-list syntax right the first time.** The rule: `<relatedList>`
   takes `ChildObject__c.LookupField__c`, not the relationship name and not relationship-name-
   plus-`__r` (both look plausible, both fail). No Layout at all means no related lists AND
   (see next step) stray global quick actions.

5. **`<quickActionList/>` explicitly, even empty, on every Layout.** Without it, Salesforce
   falls back to the org's global default quick actions (New Contact, New Opportunity, etc.)
   for that object's action bar -- even on an otherwise-complete, correct, custom Layout. This
   is easy to miss because nothing else about the Layout looks wrong. Add it as standard
   practice on every Layout, not just when the stray buttons are actually noticed.

6. **Tabs + a Lightning App, if the object needs to be reachable via the App Launcher** (not
   just Setup's Object Manager). One `CustomTab` per object, one `CustomApplication` bundling
   them. Then **also** grant `tabSettings` (per tab) and `applicationVisibilities` (per app) on
   the Permission Set -- deploying the tab/app doesn't make them visible to anyone by default,
   same class of problem as step 2.

7. **LWC placement AND org-default activation, both fully deployable -- confirmed live
   2026-08-22, no manual Lightning App Builder steps needed at all.**
   - A component with `isExposed: true` + `lightning__RecordPage` target does NOT appear on any
     record page by itself. Author and deploy a `FlexiPage` (`.flexipage-meta.xml`) directly.
     Real structure, confirmed by retrieving a genuine working example from the same org rather
     than guessing (same technique as the related-list discovery -- create an empty placeholder
     file at the exact metadata path, `sf project retrieve start --source-dir <that path>`):
     - `<flexiPageRegions>` blocks, each with `<name>`, `<type>` (`Region` for a real template
       region name like `header`/`main`; a bare `Facet` must be referenced FROM a parent
       container or the deploy fails with "Facet X is not used anywhere").
     - Each region's `<itemInstances>` holds exactly ONE `<componentInstance>` per entry --
       multiple components in one region need multiple sibling `<itemInstances>` blocks, not
       one `itemInstances` with several `componentInstance` children (fails: "Element
       componentInstance is duplicated").
     - A custom LWC's `componentName` is `c:<camelCaseComponentName>` (managed-package
       components use their real namespace, e.g. `copado:scriptEditor` -- confirmed by finding
       one already live in this org). No special properties needed for a plain custom
       component -- just `componentName` + `identifier`.
     - **`<mode>Replace</mode>` on a region requires a `<parentFlexiPage>` reference** (a base
       template page being overridden) -- fails with "region specifies mode REPLACE but a
       parent region enabling that mode doesn't exist" if `parentFlexiPage` is absent. Building
       a page from scratch (not overriding one): omit `mode` entirely.
     - Top-level: `masterLabel`, `sobjectType`, `template><name>flexipage:recordHomeTemplateDesktop</name></template>`, `type: RecordPage`.
   - **Org-default activation** (no human ever clicks "Activate"): add an `actionOverrides`
     block directly to the object's `.object-meta.xml`:
     ```xml
     <actionOverrides>
         <actionName>View</actionName>
         <type>Flexipage</type>
         <content>MyFlexiPageName</content>
         <formFactor>Large</formFactor>
     </actionOverrides>
     ```
     Confirmed live: deploying this makes the FlexiPage the real default View page for every
     user immediately, no Lightning App Builder session required at all.

8. **An `@AuraEnabled` method that no LWC imports is NOT a feature.** This is the same failure
   class as steps 2-7, one layer up, and it is the easiest one to mistake for done: the Apex
   deploys, class access is granted, tests pass, coverage is fine — and no human can reach it.
   Confirmed the expensive way 2026-08-23: a `WorkspaceResolver.listWorkspaceConnections` method and
   `.previewResolution` were built, deployed, granted, and imported by **zero** components. The
   capability was reported as "built" twice while the person using it kept saying they could not
   see it. They were right both times.

   **Before calling any backend capability done, verify the last mile:**

   ```bash
   # Does anything actually call it?
   grep -rn "myApexMethod" force-app/main/default/lwc/
   # And which Apex does the component you MEANT to change actually import?
   grep -n "^import.*@salesforce/apex" force-app/main/default/lwc/<bundle>/<bundle>.js
   ```

   That second command matters just as much. A related trap: the fix lands in one class while the
   UI calls a **different** class holding its own copy of the old logic. `WorkspaceResolver`
   was fixed to read org-level integrations; the global-menu LWC calls
   `GlobalAssistantController.getWorkspaceDetail`, which had its own blind copy — so the bug
   was "fixed" and the screen was unchanged. **Trace from the component the user is actually
   looking at, backwards — never from the class you just edited, forwards.**

   Say "the logic exists" when that is what is true. "Built" means a human can reach it.

## Deploy DRY-RUNS are a discovery tool — use them instead of guessing metadata XML

When you do not know the shape of a metadata type, do not infer it and do not trust a doc sample
you cannot verify. **Probe the org.** `sf project deploy start --metadata-dir <dir> --dry-run`
creates nothing and Salesforce's validator names what is wrong with unusual precision.

Established 2026-08-23 working out the `ExternalCredential` JWT shape in four probes, after the
documentation route failed (our doc corpus had silently dropped every code sample):

| Probe | What the validator answered |
|---|---|
| A made-up element | `authenticationProtocolVariant invalid at this location in type ExternalCredential` — the element does not exist |
| Protocol set, nothing else | `The authentication protocol "Jwt" requires the following external credential parameter types: SigningCertificate` — named the missing piece |
| A plausible-but-wrong enum | `External Credentials don't support the "JwtExchange" authentication protocol` |
| Right shape, wrong format | `The JWT aud claim has invalid JSON syntax` — pinpointed the field AND the rule |

**Pair it with the Tooling describe for enums**, which lists picklist values outright:

```apex
// /services/data/v61.0/tooling/sobjects/<Type>/describe -> fields[].picklistValues[].value
// gave: NoAuthentication, Oauth, Password, AwsSv4, Jwt, JwtExchange, Custom, Basic
```

Note a deliberately invalid enum in a DEPLOY says only "not a valid value" without listing the
alternatives — the describe is what enumerates them. Use both.

**Why this beats the docs.** It is authoritative for THIS org's API version, it costs seconds, and
it works when the documentation is missing, stale, or contradicts itself. `sf project retrieve
start --metadata <Type>:<Name>` is the natural companion for reading an existing example — though
note it has returned "Nothing retrieved" in some projects, in which case probe forward instead.

## Check the official Salesforce sf-skills repo FIRST, next time

Found 2026-08-22 (after already hand-solving everything in this checklist the slow way):
`github.com/forcedotcom/sf-skills` has official, maintained skills that directly cover this
entire checklist -- `platform-flexipage-generate` (confirms `sf template generate flexipage`,
via `sf plugins install templates`, generates valid FlexiPage XML from a CLI template instead of
hand-authoring it -- would have skipped the whole region/mode/Facet trial-and-error in step 7),
`platform-custom-object-generate`, `platform-custom-field-generate`, `platform-custom-tab-generate`,
`platform-custom-application-generate`, `platform-permission-set-generate`,
`platform-list-view-generate`, `integration-connectivity-connected-app-configure` (covers the
Connected-App-vs-ECA decision directly), `experience-lwc-generate`. **Check this repo's relevant
skill before hand-authoring any of these metadata types again** -- this checklist remains
valuable as a record of WHY each step matters and what fails silently without it, but the
official skills likely generate correct XML faster than doing it by hand.

## Why this matters as one checklist, not seven separate facts

Each step's failure mode looks like something ELSE went wrong -- a field silently invisible
looks like a bad deploy; a missing related list looks like a wrong object reference; stray
quick actions look like a permission problem; an LWC that "isn't showing up" looks like a
metadata deploy failure when the deploy actually succeeded fine. Running this whole list in
order, every time a new object is built, is faster than debugging each symptom as if it were a
novel problem -- which is exactly what happened building a real custom data model.

## Changing the Name field type from AutoNumber to Text invalidates every layout

Confirmed live 2026-08-23. An AutoNumber Name is not a required layout field; a **Text Name is**.
So converting the type leaves existing layouts silently invalid — the object deploy succeeds and
gives no hint, and the breakage only surfaces on the NEXT layout deploy, possibly weeks later.

Two errors, in this order, both from the same cause:
1. `Layout must contain an item for required layout field: Name` — add a `<layoutItems>` for Name.
2. `Field:Name must be Required` — its `<behavior>` must be **`Required`**, not `Edit`.

**So after any nameField type change, redeploy every layout for that object in the same change.**
And remember the ordinary trap this sits on top of: a new field is invisible until it is on the
layout, even with FLS granted — deploying the field and the permission set is only two thirds of
the job.

## `--` is illegal inside an XML comment, and it only breaks WHOLE-tree deploys

Cost two separate debugging rounds in one day (2026-08-23) -- once in a committed `.example` file,
then again twenty minutes later in a freshly written comment.

XML forbids `--` inside `<!-- -->`. Salesforce reports it as `Error parsing file: The string "--"
is not permitted within comments. (99:60)`, naming a line/column INSIDE the comment, which reads
like a corrupt file rather than a punctuation rule.

The reason it hides: a **targeted** deploy of the components you changed passes fine, so it can sit
in the repo indefinitely. It only surfaces when someone deploys the whole source tree.

- Never write `--` in a comment in any `.xml` metadata file. Use `:` or a single `-`.
- When scrubbing existing ones programmatically, **do not let the regex eat the delimiters** --
  a naive `replace("--", "-")` across the file turns `<!--` into `<!-` and `-->` into `->`, which
  is a worse and more confusing break. Match the comment body only.
- Cheap check before a big deploy:
  ```bash
  python3 -c "
  import re,glob,sys
  for f in glob.glob('force-app/**/*.xml', recursive=True):
      for c in re.findall(r'<!--(.*?)-->', open(f).read(), re.S):
          if '--' in c: print('ILLEGAL --:', f)"
  ```

## A redeployed LWC is NOT served immediately — and a normal refresh hides that

Confirmed independently twice on 2026-08-23, costing real debugging time both times.

After `sf project deploy start` succeeds for an LWC bundle, Salesforce's Lightning module cache
keeps serving the PREVIOUS bundle for **several minutes**. A normal page refresh silently returns
the stale component — no error, no warning — so a correct fix looks like a failed one. Even a
**brand-new tab with a cache-busted URL** still received the old bundle, which rules out browser
caching: the staleness is server-side.

**How to tell staleness from a real bug, instead of guessing:**
1. Query the org's actual copy — `SELECT Source FROM LightningComponentResource WHERE
   LightningComponentBundle.DeveloperName = '<bundle>' AND FilePath LIKE '%.css'` (Tooling API) —
   and grep it for your change. If it is there, the deploy worked and you are looking at cache.
2. In the page, read the loaded rule back: walk shadow roots collecting `<style>` text (LWC injects
   style ELEMENTS; they are not in `adoptedStyleSheets`, so scanning that finds nothing) and check
   whether your new rule or the old one is present.

**Remedies**, in order of reliability: enable **Debug Mode** on the user (Setup > Users > Debug
Mode) which bypasses the cache entirely; log out and back in; or hard reload (Cmd+Shift+R) and
wait a few minutes.

**Do not "fix" a bug that is already fixed** — that is the real cost of not knowing this.

## Record pages that don't look terrible: the second half of the checklist (2026-08-24)

The original checklist gets an object to *function*. These four steps are what make its records
look like a real product instead of a bare data browser — each was discovered by a user reporting
"the objects all still look like ass" about objects that were technically complete.

1. **Compact layout, or the header shows Name + owner and nothing else.** No compact layout ever
   exists by default. Source format: `objects/<Obj>/compactLayouts/<Api>.compactLayout-meta.xml`
   with `<fullName>` REPEATED INSIDE the XML (a child of CustomObject needs it; omitting it fails
   with "element fullName missing for a child of type CompactLayout"), `<fields>` entries (Name
   first; long text areas are not allowed), `<label>`. Then point
   `<compactLayoutAssignment>` in the object-meta at it (default is `SYSTEM`).
2. **An empty `<quickActionList/>` removes ALL buttons, not just the stray ones.** The earlier fix
   for wrong global actions (empty quickActionList) also strips Edit/Delete/Clone. The buttons
   Lightning shows come from `<platformActionList>` with `<actionListContext>Record</actionListContext>`
   and `StandardButton` items (`Edit`, `Clone`, `Delete`, each with `sortOrder`). Add it to every
   layout alongside the empty quickActionList.
3. **An org-default FlexiPage REPLACES the layout's page composition entirely.** Deploying a
   FlexiPage View override silently discards the layout's related lists — the exact related lists
   this checklist worked hard to build. Related lists must be added to the FlexiPage explicitly:
   `force:relatedListSingleContainer` with `parentFieldApiName` = `<Obj>.Id` and
   `relatedListApiName` = the child relationshipName + `__r` (NOT the `<ChildObject>.<Field>`
   syntax layouts use — flexipages and layouts name the same related list differently).
   Tabs: `flexipage:tabset` (property `tabs` → a Facet region) holding `flexipage:tab` items
   (properties `title`, `body` → another Facet, `active` on the default tab). The stock
   `flexipage:recordHomeTemplateDesktop` template has an unused `sidebar` region — single-column
   stacking is a choice, not a template limit.
4. **SLDS Path**: `pathAssistants/<Name>.pathAssistant-meta.xml` (`entityName`, `fieldName` of the
   picklist, `pathAssistantSteps` for per-stage guidance, `recordTypeName>__MASTER__`), PLUS the
   component on the FlexiPage: the real name is **`runtime_sales_pathassistant:pathAssistant`** —
   `flexipage:pathAssistant` and `runtime_sales_pathassistant:pathAssistantHome` both fail with
   "couldn't retrieve the design time component information". Found by scanning real org
   FlexiPages via Tooling (`GET /tooling/sobjects/FlexiPage/{Id}` returns full Metadata; grep
   componentName for "path") — after two failed guesses, which is exactly the "retrieve a real
   working example" rule this skill already teaches.

**Bonus deploy-tooling gotchas from the same session**: `sf project deploy report` requires
`--use-most-recent` (bare invocation errors); sf CLI colorizes `--json` output EVEN WHEN PIPED —
strip ANSI (`sed 's/\x1b\[[0-9;]*m//g'`) or set FORCE_COLOR=0 before parsing.

## Learned from the 2026-08-25 head-to-head run (live, both lanes)
- After deploying the permset, **assign it to the CLI user you verify with**, or every SOQL check lies (`No such column`).
- FlexiPage: do NOT add a `runtime_platform_actions:actionsContainer` region ("couldn't retrieve the design time component information") — header actions come from the layout's `platformActionList`.
- **`sharingModel` changes are silently skipped by a directory deploy** (`sf project deploy start -d .` reports Succeeded, OWD unchanged). Deploy the object explicitly: `-m CustomObject:<Obj>` (async, ~60 s) and poll `EntityDefinition.InternalSharingModel`. Redeploy SharingRules AFTER the OWD flip or share rows never materialise.
- CustomMetadata record `<label>` (MasterLabel) max is 40 chars; longer fails the whole (atomic) deploy.
