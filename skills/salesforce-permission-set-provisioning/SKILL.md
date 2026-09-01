---
name: salesforce-permission-set-provisioning
description: "Field deployed but describe cannot see it / field is invisible to users / a new custom field will not accept input / a record update fails silently on a new field / only Master-Detail fields show in describe. Salesforce grants ZERO field-level security to anyone, System Administrator included, on newly created custom fields: they deploy successfully and stay invisible and uneditable. Use immediately after deploying custom objects or fields and BEFORE attempting to read or write data against them. The recipe: write a permission set granting access with a separate fieldPermissions entry per non-Master-Detail field, deploy it, assign it, then re-verify describe. Do not deploy a field and assume it is usable."
license: MIT
compatibility: "Requires a Salesforce org and Metadata API deployment tooling (Salesforce CLI or equivalent). No external services."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "salesforce-metadata"
---

# Provision a Permission Set for newly deployed custom schema

Confirmed live, 2026-08-22, against a real Enterprise Edition org while building a custom data model.

## The key fact that isn't obvious going in

**Deploying a custom object or field successfully does NOT make it visible or usable.**
Salesforce grants zero Field-Level Security to any profile by default for newly created custom
fields. `sf project deploy start` can report `success: true, componentsDeployed: N/N` and the
schema is completely unusable afterward: `sf sobject describe` silently omits every ordinary
custom field (Text, Picklist, LongTextArea, etc. -- anything FLS-controlled) from the field
list, and `sf data create record` / any API write against those fields will not see them either.
**The one exception**: Master-Detail relationship fields ARE always visible (they're structural,
not FLS-controlled) -- so a quick describe check that only shows the M-D field(s) and nothing
else is the exact signature of this problem, not a deploy failure.

Nothing errors loudly. This is easy to mistake for "the deploy silently failed" when it actually
succeeded -- the deploy result and the describe result are simply reporting two different
things (schema existence vs. this user's visibility into it).

## Steps

1. **After any object/field deploy**, before trying to read/write data against it, write a
   Permission Set granting the access needed:

   `force-app/main/default/permissionsets/<Name>.permissionset-meta.xml`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
       <label>Human-Readable Label</label>
       <description>What this grants and why.</description>

       <objectPermissions>
           <object>Your_Object__c</object>
           <allowCreate>true</allowCreate>
           <allowRead>true</allowRead>
           <allowEdit>true</allowEdit>
           <allowDelete>true</allowDelete>
           <viewAllRecords>true</viewAllRecords>
           <modifyAllRecords>true</modifyAllRecords>
       </objectPermissions>
       <!-- one objectPermissions block per object -->

       <fieldPermissions>
           <field>Your_Object__c.Some_Field__c</field>
           <readable>true</readable>
           <editable>true</editable>
       </fieldPermissions>
       <!-- one fieldPermissions block per NON-Master-Detail field -- Master-Detail fields
            don't need (and can't take) a fieldPermissions entry, they're always visible -->
   </PermissionSet>
   ```

   Cover every custom object and every non-Master-Detail field the new schema introduces --
   missing even one field silently leaves just that field invisible, same failure mode.

2. **Deploy it**: `sf project deploy start --source-dir force-app/main/default/permissionsets --target-org <alias>`
3. **Assign it** to whichever user needs access:
   `sf org assign permset --name <Name> --target-org <alias>`
   (assigns to the CLI's currently-authenticated user; add `--on-behalf-of <username>` for a
   different user)
4. **Re-verify** with the same `sf sobject describe --sobject <Object> --target-org <alias>
   --json` check that showed the problem -- every field should now appear in the custom-field
   list, not just Master-Detail ones.

## When this recurs

Any time NEW custom objects or fields are deployed (a new feature needing a new field, a schema
change, anything) -- re-run this same recipe (update or extend the
Permission Set, redeploy, the assignment from step 3 does not need to be repeated once already
assigned). This is worth systematizing rather than doing by hand each time as the schema grows.
section for the larger platform-capability version of this problem (a shipped admin permission
set kept in sync automatically, and a separate, not-yet-designed question about scoped/dynamic
runtime grants for things like Human Gate approvers).

## Learned from the 2026-08-25 head-to-head run (live, both lanes)
- **`You cannot deploy to a required field: <Obj>.<Field>`** — a PermissionSet must NOT carry `fieldPermissions` for a required custom field; required fields are implicitly readable/editable. Drop the entry.
- **`Element fieldPermissions is duplicated at this location in type PermissionSet`** — retrieved PermissionSet XML is strictly element-ordered (`applicationVisibilities < classAccesses < customPermissions < description < fieldPermissions < flowAccesses < hasActivationRequired < label < objectPermissions < pageAccesses < recordTypeVisibilities < tabSettings < userPermissions`). Insert new blocks INSIDE the matching contiguous group, never after `<label>`.
- **Assign the permset to the deploying/CLI user too** — Metadata API grants FLS to nobody, including the deployer; every `sf data query` you run as SysAdmin will say `No such column` until you do (`sf org assign permset --name <PS>`).
- A child object's permset must also grant Read on its master (`Permission Read <Child> depends on permission(s): Read <Master>`).
