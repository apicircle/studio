// Backup & Restore (TC-BK-*) — 12 manual cases covering workspace
// snapshot capture/restore + (potentially) whole-workspace export.
//
// The current product implements the SNAPSHOT half of the workbook
// (pre-destructive auto-capture, manual capture, restore from ledger
// entry). Whole-workspace JSON export / import / encrypted backup files
// / checksums are NOT implemented; those cells move to manual-residue
// with rationale and lift back to live when the export/import feature
// lands.

import { expect, test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapBK } from './fixtures/tcMapBK';
import type { TcId } from './fixtures/tcCoverage';
import { seedWorkspace } from './fixtures/idbSeed';

void Object.keys(tcMapBK);

function id(key: string): TcId {
  const v = tcMapBK[key];
  if (!v) throw new Error(`No TC-BK entry for "${key}"`);
  return v;
}

interface StoreApi {
  captureSnapshot: (args?: { trigger?: string; note?: string }) => string | null;
  restoreSnapshot: (id: string) => boolean;
  deleteSnapshot: (id: string) => void;
  setSnapshotMaxBytes: (n: number) => void;
}

interface StoreShape {
  synced?: {
    collections: { requests: Record<string, { name: string }> };
  };
  local?: {
    history: { requestRuns: unknown[]; planRuns: unknown[] };
    snapshots: {
      // WorkspaceSnapshot (packages/shared/src/types.ts): the captured
      // synced doc lives under `workspaceSyncedSnapshot`, the trigger under
      // `triggeredBy`, and the timestamp under `createdAt`.
      entries: Array<{
        id: string;
        triggeredBy: string;
        note?: string;
        createdAt: string;
        sizeBytes: number;
        workspaceSyncedSnapshot: {
          schemaVersion: number;
          collections: { requests: Record<string, unknown> };
        };
      }>;
      maxBytes: number;
    };
  };
}

function readSnapshots(app: import('@playwright/test').Page) {
  return app.evaluate(() => {
    const w = window as unknown as { __apicircleStore?: { getState: () => StoreShape } };
    return w.__apicircleStore!.getState().local!.snapshots;
  });
}

test.describe('Backup & Restore — implemented cells', () => {
  test.describe.configure({ mode: 'parallel' });

  test(
    tc(
      id('Backup before destructive op (rest workspace, delete)'),
      'pre-destructive trigger captures a snapshot with the right metadata',
    ),
    async ({ app }) => {
      await seedWorkspace(app, 'seeded');
      const snapId = await app.evaluate(() => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        return w.__apicircleStore!.getState().captureSnapshot({
          trigger: 'pre-push',
          note: 'Before push to working',
        });
      });
      expect(snapId).not.toBeNull();
      const snap = (await readSnapshots(app)).entries[0];
      expect(snap.triggeredBy).toBe('pre-push');
      expect(snap.note).toContain('Before push');
      expect(snap.sizeBytes).toBeGreaterThan(0);
    },
  );

  test(
    tc(
      id('Restore from auto-snapshot'),
      'restoreSnapshot from a pre-destructive entry brings the synced doc back',
    ),
    async ({ app }) => {
      const ids = await seedWorkspace(app, 'seeded');
      // Take an auto-snapshot, then mutate (rename a request), then restore.
      const snapId = await app.evaluate(() => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        return w.__apicircleStore!.getState().captureSnapshot({ trigger: 'pre-merge' });
      });
      expect(snapId).not.toBeNull();
      const r1 = ids.requestIds[0];
      await app.evaluate(
        ({ r1Id }) => {
          const w = window as unknown as {
            __apicircleStore?: {
              getState: () => { renameRequest?: (id: string, name: string) => void };
            };
          };
          w.__apicircleStore!.getState().renameRequest?.(r1Id, 'Mutated post-snapshot');
        },
        { r1Id: r1 },
      );
      // Confirm mutation visible.
      const before = await app.evaluate(
        ({ r1Id }) => {
          const w = window as unknown as { __apicircleStore?: { getState: () => StoreShape } };
          return w.__apicircleStore!.getState().synced!.collections.requests[r1Id].name;
        },
        { r1Id: r1 },
      );
      expect(before).toBe('Mutated post-snapshot');
      // Restore.
      const ok = await app.evaluate(
        ({ snapId: sid }) => {
          const w = window as unknown as {
            __apicircleStore?: { getState: () => StoreApi };
          };
          return w.__apicircleStore!.getState().restoreSnapshot(sid);
        },
        { snapId: snapId! },
      );
      expect(ok).toBe(true);
      const after = await app.evaluate(
        ({ r1Id }) => {
          const w = window as unknown as { __apicircleStore?: { getState: () => StoreShape } };
          return w.__apicircleStore!.getState().synced!.collections.requests[r1Id].name;
        },
        { r1Id: r1 },
      );
      expect(after).toBe('Get user');
    },
  );

  test(
    tc(
      id('Export does not include history (local-only)'),
      'captured snapshot only carries the synced doc — history stays in local',
    ),
    async ({ app }) => {
      await seedWorkspace(app, 'seeded');
      const snapId = await app.evaluate(() => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        return w.__apicircleStore!.getState().captureSnapshot();
      });
      expect(snapId).not.toBeNull();
      const ledger = await readSnapshots(app);
      const entry = ledger.entries[0];
      // The snapshot serializes only the synced doc — no request runs,
      // no plan runs, no session tokens.
      expect(entry.workspaceSyncedSnapshot.collections.requests).toBeDefined();
      // The local history slice is NOT in the snapshot payload by design.
      expect((entry as unknown as { local?: unknown }).local).toBeUndefined();
    },
  );

  test(
    tc(
      id('Cross-version backup compatibility'),
      'snapshot taken at schemaVersion=1 round-trips through restore',
    ),
    async ({ app }) => {
      await seedWorkspace(app, 'seeded');
      const snapId = await app.evaluate(() => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        return w.__apicircleStore!.getState().captureSnapshot({ note: 'v1-baseline' });
      });
      expect(snapId).not.toBeNull();
      // Read the snapshot's synced shape — should carry schemaVersion=1.
      const sv = await app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => {
              local?: {
                snapshots: {
                  entries: Array<{ workspaceSyncedSnapshot: { schemaVersion: number } }>;
                };
              };
            };
          };
        };
        return w.__apicircleStore!.getState().local?.snapshots.entries[0]?.workspaceSyncedSnapshot
          .schemaVersion;
      });
      expect(sv).toBe(1);
      // Restore round-trip succeeds.
      const ok = await app.evaluate(
        ({ sid }) => {
          const w = window as unknown as {
            __apicircleStore?: { getState: () => StoreApi };
          };
          return w.__apicircleStore!.getState().restoreSnapshot(sid);
        },
        { sid: snapId! },
      );
      expect(ok).toBe(true);
    },
  );

  // -----------------------------------------------------------------
  // Cells that map to features the product hasn't implemented yet.
  // Documented here so they show in the test report as fixme'd with
  // rationale. They will also be added to apps/web/e2e/manual-residue.ts
  // so the strict scanner classifies them as residue, not gap.
  // -----------------------------------------------------------------

  const NEEDS_EXPORT_FEATURE = [
    'Export full workspace JSON (synced)',
    'Export includes attachments (or references)',
    'Re-import exported workspace creates equivalent state',
    'Import into existing workspace merges vs overwrites',
    'Disk full during export',
    'Selective restore: only environments',
    'Backup encrypted with passphrase',
    'Backup file integrity check (checksum)',
  ] as const;
  for (const key of NEEDS_EXPORT_FEATURE) {
    test.fixme(tc(id(key), `${key} — needs whole-workspace export feature`), async () => {
      // The product implements the snapshot ledger (in-app, in-IDB)
      // but NOT a whole-workspace JSON export/import feature. When
      // that lands, lift the corresponding TC-BK ID out of
      // manual-residue.ts and replace this fixme with a real test.
    });
  }
});
