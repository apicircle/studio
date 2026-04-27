# API Circle Studio v2

Greenfield rebuild of API Circle Studio with:

- Two-document Workspace JSON schema (`workspace.synced.json` + `workspace.local.json`) in IndexedDB
- Tailwind CSS styling (no inline styles, no third-party UI lib)
- Working-branch Git flow: auto-create branch from main, push to save, create PR directly from app
- Per-connection release management for API Connections (private + public marketplace)

## Layout

```
apps/
  web/                  Vite + React shell
packages/
  ui-components/        All React UI
  core/                 Request execution, env resolution, assertions
  shared/               Types, generateId, encryption helpers
  git/                  GitHub API client + sync logic
```

## Develop

```bash
pnpm install
pnpm dev:web            # http://localhost:5174
```

## Status

Phase 1 (foundation) — scaffold, IDB layer, theme tokens, Tailwind primitives, top nav + sidebar shell.
