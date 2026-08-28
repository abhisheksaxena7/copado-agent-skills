# Architecture and profiles

The browser receives one self-contained HTML response from Apps Script. `doGet()` sets domain-compatible iframe headers and the mobile viewport.

- `static`: `HtmlService.createHtmlOutputFromFile`; no Google service calls.
- `sheet`: `HtmlService.createTemplateFromFile`; Apps Script reads approved fields through `Sheets.Spreadsheets.Values.get`, serializes a whitelist into an inline data tag, and the page falls back to fictional samples locally.
- `canvas`: esbuild bundles vendored `src/App.tsx`, React, and the compatibility adapter into one HTML file before `clasp push`.

Choose Sheet only when Google data is necessary. Choose Canvas only when the source genuinely requires React or Canvas behavior. Profile conversion after deployment is an architecture and OAuth review, not a cosmetic toggle.

Generated app repositories are private. The public template contains only reusable source and fictional fixtures. Script/Sheet/deployment IDs and operational data stay in Script Properties, ignored files, repository variables, or approved internal records.
