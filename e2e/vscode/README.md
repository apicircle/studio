# @apicircle/e2e-vscode

E2E suite for the API Circle Studio VS Code extension (`apps/vscode`).

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
pnpm --filter apicircle-vscode build        # build the extension under test
pnpm --filter @apicircle/e2e-vscode build   # compile the tests
pnpm --filter @apicircle/e2e-vscode test:e2e
```

First run downloads ~100MB of VS Code. Subsequent runs reuse the cache.

## What it covers

`src/test/*.test.ts`: workspace creation and multi-root, new requests and
validation, cancel, environments and plans, the mock lifecycle, view and YAML,
the runs channel, the vault and its device auto-configuration, notebooks, and
the live-GitHub suite below.

## CI notes

CI: `vscode.yml`'s `cross-host-smoke` job runs this suite on pushes to `main`
that touch `apps/vscode/` or `e2e/vscode/`, against VS Code stable and Insiders
on Ubuntu (xvfb). Pull requests get typecheck only for this package.

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
No CI job runs it; run it by hand.
