# Linked Pets API

A second workspace fixture meant to be linked into the demo workspace.
Plan §10.1 calls for "a linked-workspace example pointing at a sibling
repo so the link / pin / update flow is exercisable." This file is
that target.

## What's in here

- `workspace.json` — a minimal workspace with two requests against an
  imaginary `/pets` API and an environment pointing at port 4041.
- A `releases.self` ledger with two versions (0.1.0 and 0.2.0) so the
  consumer can exercise pin / switch / changelog viewer flows.

## Wiring it up

The studio's link flow today expects a GitHub repo as the source. To
exercise the link flow:

1. Push this directory to its own GitHub repo (e.g.
   `your-org/pets-api-workspace`).
2. In the studio, open Link Workspace → Link a private workspace.
3. Enter the repo + branch and click Link.
4. The card surfaces both versions; switch the pinned version to
   exercise the confirm dialog gate.

A future revision will support file:// / path-relative links so the
sibling fixture can be linked without a publish step.
