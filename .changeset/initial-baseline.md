---
'@apicircle/shared': minor
'@apicircle/core': minor
'@apicircle/git': minor
'@apicircle/ui-components': minor
---

P1–P9 baseline. First release-ready cut of API Circle Studio:

- Two-document workspace schema (synced + local) with stable JSON
  serialization for clean Git diffs.
- Workspace + Git sync: PAT connect with scope guidance, session
  rotation without logout, auto-branch, push (incl. attachments + size
  limits), PR creation with missing-scope gate, on-demand refresh, 3-way
  conflict resolver, attachment pull-side download.
- Link Workspace + releases: private + public link, marketplace search,
  cached collections + release ledger, version pinning with confirm
  dialog, changelog viewer, required-secret-key inputs, workspace-self
  release publishing with typed-confirm yank.
- Execution plans: sequential runner, plan-level env priority,
  cross-workspace plan steps against cached linked snapshots, with /
  without assertions, per-plan run history.
- Help Center, keyboard shortcuts, inline guide text touchpoints.
- Native OS-keychain secret storage on desktop (Electron + safeStorage).
- Regression suite: schema-shape locks, demo workspace + mock backend,
  attachment-cascade integration tests, Playwright golden paths for
  every panel.
