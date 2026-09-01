---
name: salesforce-lwc-build-patterns
description: "A deployed LWC fix is not showing up / the component is served stale after deploy / an Apex call is slow only on mount / an animation makes the page shift / the bottom of a panel is unreachable / the component \"isn't working\". The most painful LWC bugs are not in your code, they are in Lightning's caching, action queue, or layout behavior: correct deployed code served from a server-side module cache for minutes, imperative Apex on mount taking tens of seconds until it is deferred past the bootstrap burst, animating layout-affecting properties instead of transform and opacity, and a scroll container structured so the bottom can never be reached. Use when an LWC behaves wrongly after a successful deploy, when tuning perceived performance, or when styling a component to match SLDS."
license: MIT
compatibility: "Requires a Salesforce org with Lightning Web Components and deployment tooling (Salesforce CLI or equivalent). No external services."
metadata:
  author: "joecopado"
  version: "0.1.0"
  domain: "salesforce-lwc"
---

# LWC build patterns

Most painful LWC bugs are not in your JavaScript. They are in the platform's caching, action
queue, or layout behaviour — which is why re-reading your own correct code doesn't find them.

## A deployed fix can be invisible — SERVER-side module cache

**Cost real debugging time twice, on the same day, to two people working independently.**

After a successful LWC deploy, the org genuinely has the new code — retrieve it and you can read
the fix. But the browser is served the **old bundle**, even in a brand-new tab, with a
cache-busting query param, after a hard reload. It is not the browser cache. Lightning caches
compiled modules server-side.

**Before re-fixing code that looks broken, verify what is actually deployed:**

```bash
sf project retrieve start --metadata LightningComponentBundle:myComponent --target-org <alias>
# then read the retrieved file. If the fix IS there, the code is right and only the wait is wrong.
```

If the deployed source is correct, do not touch it again. Waiting, a fresh session, or toggling
Debug Mode for the user clears it. Chasing this with more edits produces churn and sometimes
re-breaks working code.

## An Apex call that is slow ONLY on mount — Aura action priority

Symptom: the identical imperative Apex call takes **30–45 seconds** when auto-fired from
`renderedCallback`/`connectedCallback`, but is instant when the same call is fired by a real user
click. Two live Apex debug logs proved the Apex itself ran in <500ms both times — the entire delay
was in Lightning's action queue, before the code started.

Cause: Aura deprioritizes actions dispatched from a component lifecycle hook (no user gesture yet)
behind whatever the surrounding shell — a Global Quick Action, an App Page — is still
bootstrapping. A genuine click jumps that queue.

```js
// SLOW: dispatched during the bootstrap burst, deprioritized
renderedCallback() {
    if (!this.loaded) { this.loaded = true; this.loadData(); }
}

// FAST: deferring one macrotask lets the initial burst clear; behaves like a post-load trigger
renderedCallback() {
    if (!this.loaded) { this.loaded = true; setTimeout(() => this.loadData(), 0); }
}
```

If an auto-fired call is slow but a click-fired one is fast, suspect this **before** assuming a
concurrency or sequencing bug in your own code. Confirm with a real debug log rather than guessing
— see the `sf-live-apex-debug-log` skill.

## Never animate a property that triggers layout

A pulsing "active" indicator animated `border-left-width` between 3px and 7px. Every frame
re-laid-out the surrounding content, so panels and text visibly shifted left and right. The user's
words: **"Makes me sea sick."**

Animating `width`, `height`, `border-width`, `padding`, `margin`, `top/left`, or anything else
that affects layout forces reflow on every frame. Animate **`transform`** and **`opacity`** only —
they are composited and never reflow.

```css
/* BROKEN: relayouts the page 60x a second */
@keyframes glow { 0%,100% { border-left-width: 3px; } 50% { border-left-width: 7px; } }

/* CORRECT: a pseudo-element scaled on the compositor, zero layout impact */
.node_pulse { position: relative; }
.node_pulse::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 7px;
    background: var(--accent); transform-origin: left center;
    animation: glow 1.6s ease-in-out infinite;
}
@keyframes glow {
    0%, 100% { transform: scaleX(0.45); opacity: 0.75; }
    50%      { transform: scaleX(1);    opacity: 1; }
}
```

Reserve the space statically (fixed width on the pseudo-element) so the surrounding layout is
identical whether the animation runs or not. Also respect
`@media (prefers-reduced-motion: reduce)` — disable the animation there.

## Scroll containers: the bottom becomes unreachable

A chat panel scrolled its inner `.chat-log`, but not the panel itself. Once a conversation had
enough content, the input and send button at the bottom **could not be reached at all** — the
Quick Action's outer chrome provides no scrollbar for content that overflows its declared height.

The rule: if a component can grow past its container, **something must own the outer scroll.**

```css
.my-panel {
    max-height: 80vh;      /* or a fixed px height inside a Quick Action */
    overflow-y: auto;      /* the WHOLE panel scrolls, so controls stay reachable */
    display: flex; flex-direction: column;
}
.my-panel__log { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.my-panel__footer { flex: 0 0 auto; }   /* input never scrolls out of existence */
```

`min-height: 0` on the flex child is required — a flex item defaults to `min-height: auto` and
refuses to shrink below its content, which silently defeats the inner `overflow-y`.

Test this deliberately with a lot of content. It is invisible with three messages and fatal with
thirty.

## Theme and contrast: use SLDS tokens, and verify them

Lightning renders in light and dark. Hardcoded hex colors that look right in one are unreadable in
the other. Use SLDS global styling hooks (`--slds-g-color-*`, `--slds-g-spacing-*`) so the platform
supplies theme-correct values.

But **verify the specific token renders with real contrast** — a real latent bug came from using
`--slds-g-color-accent-container-2`, which resolves to a value with almost no contrast against
its own foreground in one theme. A token name that sounds right is not proof. Look at it, in both
themes, with real content.

## Surfacing errors instead of swallowing them

An LWC that catches an Apex error and renders nothing is indistinguishable from one that is still
loading. Always give the user the real message:

```js
readError(e) {
    // The shape varies: AuraHandledException, a DML error list, or a raw JS error.
    return e?.body?.message || e?.body?.[0]?.message || e?.message || 'Unexpected error';
}
```

Throw `AuraHandledException` from Apex with a message written for a human — the default swallows
your text and shows a generic script error. Set it explicitly:

```apex
AuraHandledException e = new AuraHandledException(msg);
e.setMessage(msg);   // without this, the client sees "Script-thrown exception"
throw e;
```

## Conditional rendering: a getter that does not exist is silently falsy

`<template lwc:if={showThing}>` where `showThing` is never defined in the JS renders **nothing**,
with no error and no console warning. A typo'd or forgotten getter looks exactly like a feature
that is correctly hidden. When a section "isn't appearing", grep the JS for the exact property
name before debugging anything else.

## Related skills

- `sf-custom-object-build-checklist` — object/field/FLS/layout ordering, and LWC placement on a
  page. It also records the module-cache behaviour from the deploy side.
- `sf-live-apex-debug-log` — capturing a real debug log from a live LWC interaction, which is how
  the action-priority delay above was proven rather than guessed.

## Boolean @api properties MUST default to false (compiler-enforced)

`@api editable = true;` fails deploy with LWC1503. This is not a lint nit — HTML attribute
semantics make an absent boolean attribute false, so a true default is unrepresentable in
markup. Design consequence: name boolean public props so FALSE is the safe default
(`editable`, `expanded`), and remember every consumer must OPT IN explicitly — a parent that
forgets the attribute gets the false behaviour silently (e.g. a form that renders read-only
and never fires its change event). When handing an embedding contract to another developer or
agent, state this explicitly.

## Finding the real name of a standard FlexiPage component

Standard components' FlexiPage names are not guessable from their labels (the Path component
is `runtime_sales_pathassistant:pathAssistant`). When a deploy fails with "couldn't retrieve
the design time component information", stop guessing: pull real pages from the org via
Tooling — `GET /services/data/vXX.0/tooling/sobjects/FlexiPage/{Id}` returns the full
Metadata JSON — and grep `componentName` across a handful of record pages until the component
appears in a page that visibly renders the thing you want. Two minutes of scanning beats any
number of plausible guesses.

## Learned from the 2026-08-25 head-to-head run (live, both lanes)
- `sfdx-lwc-jest` wire adapters: `adapter.error(body)` already wraps the payload as `{ body }` — pass `[{ message }]`, not `{ body: [...] }`, or the component sees `[object Object]`.
- `LWC1503: "getRecord" is a wire adapter` on deploy means `__tests__` is being compiled — keep `**/__tests__/**` in `.forceignore`.
- Read-back parity check: `sf project retrieve start` IN PLACE then `git diff -w --numstat` (the `--output-dir` must be inside the project); expect Salesforce to canonicalise `c:` prefixes and trailing newlines.
