---
name: replace-with-skill-name
description: Describes what this portable skill does and the concrete requests that should trigger it.
license: MIT
compatibility: Describe required runtimes, system packages, network access, and intended products in 500 characters or fewer.
metadata:
  author: replace-with-github-owner
  version: "0.1.0"
  domain: replace-with-domain
---

# Replace with skill title

Keep this file agent-oriented and under 500 lines. Use only fields from the open Agent Skills specification. Keep all `metadata` keys and values as strings.

## Workflow

1. Classify the request.
2. Gather only decisions that materially change the result.
3. Run a dry-run before external mutations.
4. Stop at credentials, production, destructive actions, or visibility changes for human approval.
5. Verify the result.

## References

Link detailed files directly under `references/`; do not create deep reference chains.

## Scripts

Use portable POSIX shell or Node.js. Detect prerequisites and return actionable errors. Do not install global software or authenticate services without consent.
