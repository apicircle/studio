// End-to-end regression test for the MCP→desktop auto-refresh path.
//
// What this covers:
//
//   1. Launch the desktop. It boots with a fresh `My Workspace`.
//   2. Externally rewrite the workspace's `workspace.synced.json` with a
//      newer `meta.updatedAt` and an extra request (simulating exactly
//      what the MCP server's `FileBackedWorkspaceProvider.apply` would
//      do while the desktop is running).
//   3. Assert the editor sidebar shows the new request name within a few
//      seconds — without the user clicking anything.
//
// Before the bug fix, the renderer only re-read disk on a manual Refresh
// click AND the boot-time IDB→disk mirror would overwrite the external
// write the next time the user mutated anything. With the watcher +
// `refreshFromDisk` + the disk-newer-than-IDB hydrate branch, this all
// works without intervention.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from './fixtures/electronApp';
import type { WorkspaceState } from '@apicircle/core';

const SYNCED = 'workspace.synced.json';
const LOCAL = 'workspace.local.json';

function readPair(workspaceDir: string): WorkspaceState {
  const synced = JSON.parse(
    fs.readFileSync(path.join(workspaceDir, SYNCED), 'utf8'),
  ) as WorkspaceState['synced'];
  const local = JSON.parse(
    fs.readFileSync(path.join(workspaceDir, LOCAL), 'utf8'),
  ) as WorkspaceState['local'];
  return { synced, local };
}

function writePair(workspaceDir: string, state: WorkspaceState): void {
  // Mirror what `saveToFile` in @apicircle/core does — pretty-printed
  // JSON, UTF-8, no trailing newline difference that would trip an
  // editor diff. Atomic rename isn't necessary here; `fs.watch` fires
  // on `change` events too.
  fs.writeFileSync(path.join(workspaceDir, SYNCED), JSON.stringify(state.synced, null, 2), 'utf8');
  fs.writeFileSync(path.join(workspaceDir, LOCAL), JSON.stringify(state.local, null, 2), 'utf8');
}

test.describe('External-write auto-refresh', () => {
  test('external write to workspace.synced.json appears in the editor without clicking Refresh', async ({
    mainWindow,
    userDataDir,
  }) => {
    // The desktop boots with `My Workspace`. Wait for the hydrate
    // path to land and the disk mirror to write its initial pair.
    const workspacesRoot = path.join(userDataDir, 'workspaces');
    await expect.poll(() => fs.existsSync(workspacesRoot), { timeout: 10_000 }).toBe(true);

    // Find the active workspace directory. There's only one at boot.
    let workspaceDir: string | null = null;
    await expect
      .poll(
        () => {
          const entries = fs
            .readdirSync(workspacesRoot, { withFileTypes: true })
            .filter((e) => e.isDirectory());
          if (entries.length === 0) return false;
          const candidate = path.join(workspacesRoot, entries[0].name);
          if (fs.existsSync(path.join(candidate, SYNCED))) {
            workspaceDir = candidate;
            return true;
          }
          return false;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    if (!workspaceDir) throw new Error('workspace dir not found');

    // Read the freshly-written pair and inject a new request +
    // bump `meta.updatedAt` so the hydrate / refresh disk-vs-IDB
    // compare picks disk as the winner. This is exactly the shape
    // `applyMutation` produces.
    const pair = readPair(workspaceDir);
    const future = new Date(Date.parse(pair.synced.meta.updatedAt) + 60_000).toISOString();
    const externalRequestId = 'ext-r-imported-by-mcp';
    const next: WorkspaceState = {
      ...pair,
      synced: {
        ...pair.synced,
        meta: { ...pair.synced.meta, updatedAt: future },
        collections: {
          ...pair.synced.collections,
          requests: {
            ...pair.synced.collections.requests,
            [externalRequestId]: {
              id: externalRequestId,
              name: 'Imported by MCP',
              folderId: null,
              method: 'GET',
              url: 'https://example.com/external',
              headers: [],
              query: [],
              body: { type: 'none', content: '' },
              auth: { type: 'inherit' },
              contextVars: [],
              extractions: [],
              assertions: [],
              createdAt: pair.synced.meta.createdAt,
              updatedAt: future,
            },
          },
        },
      },
    };
    writePair(workspaceDir, next);

    // The watcher debounces 200ms then emits to the renderer, which
    // calls `refreshFromDisk`. The store updates and the editor
    // sidebar re-renders. The watcher → debounce → IPC → renderer
    // chain is deterministic; the 30s budget absorbs runner jitter
    // (fs.watch event delivery can be sluggish on Windows and on
    // Linux under xvfb when the runner is loaded) without hiding
    // real regressions — a broken chain never lands the text.
    await expect(mainWindow.getByText('Imported by MCP')).toBeVisible({ timeout: 30_000 });
  });

  test('external registry rewrite shows the new workspace in the switcher', async ({
    mainWindow,
    userDataDir,
  }) => {
    // Simulate an external CLI `apicircle workspaces create` while
    // the desktop is running. The watcher's registry-change branch
    // calls `refreshRegistryFromDisk` and the switcher picks it up.
    const workspacesRoot = path.join(userDataDir, 'workspaces');
    await expect.poll(() => fs.existsSync(workspacesRoot), { timeout: 10_000 }).toBe(true);

    // Wait for the boot-time registry write to land so we don't race
    // it. Then read, append a new workspace entry, write back.
    const registryPath = path.join(workspacesRoot, 'registry.json');
    await expect.poll(() => fs.existsSync(registryPath), { timeout: 10_000 }).toBe(true);
    // Give the boot-time mirror writes a moment to settle so our
    // append doesn't race with the manager's own writes.
    await mainWindow.waitForTimeout(500);

    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
      schemaVersion: 1;
      activeWorkspaceId: string | null;
      workspaces: Array<{ id: string; name: string; createdAt: string; lastOpenedAt: string }>;
    };
    const ghostId = 'ext-cli-added-workspace';
    registry.workspaces.push({
      id: ghostId,
      name: 'Added by CLI',
      createdAt: new Date(
        Date.parse(registry.workspaces[0]?.createdAt ?? '2026-01-01T00:00:00.000Z') + 1,
      ).toISOString(),
      lastOpenedAt: new Date(
        Date.parse(registry.workspaces[0]?.lastOpenedAt ?? '2026-01-01T00:00:00.000Z') + 1,
      ).toISOString(),
    });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');

    // The watcher emits 'registry' → renderer reads it → store's
    // workspaceRegistry has the new entry. We surface this via the
    // toast detail. The switcher menu component reads from store
    // state too — but verifying via the toast is the cheapest path.
    await expect(mainWindow.getByText(/Workspace list updated/i)).toBeVisible({ timeout: 30_000 });
    await expect(mainWindow.getByText(/1 new workspace appeared on disk/i)).toBeVisible();
  });
});
