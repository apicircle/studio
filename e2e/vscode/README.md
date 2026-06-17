# @apicircle/e2e-vscode

E2E suite for the APICircle Studio VS Code extension.

## How it works

1. `runTest.ts` uses `@vscode/test-electron` to download a deterministic
   VS Code build (cached under `.vscode-test/`).
2. VS Code launches with `--disable-extensions` (hermetic), opens the
   `test-fixtures/empty-workspace/` folder, and loads `apps/vscode/` as the
   "extension under development."
3. Mocha discovers every `**/*.test.js` under `dist/test/` and runs them
   inside the VS Code extension host.
4. The tests have full access to the `vscode` namespace.

## Running locally

```bash
pnpm install
pnpm --filter @apicircle/vscode build       # build the extension under test
pnpm --filter @apicircle/e2e-vscode build   # compile the tests
pnpm --filter @apicircle/e2e-vscode test:e2e
```

First run downloads ~100MB of VS Code. Subsequent runs reuse the cache.

## What ships in Phase 1 day-1

- `smoke.test.ts` — activation completes; 6 commands registered; APICircle
  view container is focusable.

Each subsequent Phase 1 commit adds tests as new features land (FileSystemProvider,
language services, response viewer, etc.). The Phase 1 gate requires the full
suite green.

## CI notes

CI matrix: `{stable VS Code, Insiders}` × `{Ubuntu, macOS, Windows}` on every
PR touching `apps/vscode/`. Weekly cron against `{Cursor, VSCodium, Windsurf}`
via Open VSX. Codespaces matrix quarterly.

### Live-GitHub suite (`test:e2e:live-github`)

A separate suite exercises the extension against a real GitHub repo to verify
the three-surface principle holds across the actual VS Code Git extension +
GitHub round-trip. Skipped by default; enable with:

```bash
APICIRCLE_E2E_LIVE_GITHUB=1 \
APICIRCLE_E2E_GITHUB_PAT=<repo-scoped PAT> \
APICIRCLE_E2E_GITHUB_REPO=apicircle/e2e-test-repo \
pnpm --filter @apicircle/e2e-vscode test:e2e:live-github
```

Each test cleans up by force-pushing the test branch back to its initial SHA.
CI runs this nightly against a dedicated test org. Phase 1 ships the harness
scaffolding; Phase 2+ fills in the git-pull / watcher / TreeView refresh
coverage as those surfaces stabilize.
