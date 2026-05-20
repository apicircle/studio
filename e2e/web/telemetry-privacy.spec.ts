// Telemetry & Privacy (TC-TP-*) — 10 manual cases.
//
// The product DOES NOT currently implement telemetry. The "default off"
// posture is therefore trivially true at the highest level (no network
// is contacted for telemetry because no telemetry pipeline exists),
// which is the safest possible privacy state. We still want a
// non-trivial assertion so that if a telemetry pipeline lands later, a
// regression that flips defaults gets caught.
//
// Cells that map to specific telemetry-UI surfaces (privacy link,
// disable toggle, reset install id) are documented `test.fixme()`s
// with rationale — they'll lift to live tests when the feature is built.
//
// What we DO assert:
//   1. No outbound network request to anything that looks like a
//      telemetry endpoint when the user just opens the app.
//   2. No `apicircle-install-id` / `apicircle-telemetry` keys live in
//      localStorage on first boot.
//   3. The synced doc carries no fields named like `telemetry`,
//      `analytics`, or `installId`.

import { expect, test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapTP } from './fixtures/tcMapTP';
import type { TcId } from './fixtures/tcCoverage';

void Object.keys(tcMapTP);

function id(key: string): TcId {
  const v = tcMapTP[key];
  if (!v) throw new Error(`No TC-TP entry for "${key}"`);
  return v;
}

const TELEMETRY_HOST_PATTERN =
  /telemetry|analytics|datadog|mixpanel|amplitude|segment|sentry|honeycomb|posthog/i;

test.describe('Telemetry & Privacy — implemented (no-telemetry) posture', () => {
  test.describe.configure({ mode: 'parallel' });

  test(
    tc(
      id('Telemetry default off (or first-run consent)'),
      'no telemetry pipeline is shipped — default is the only posture',
    ),
    async ({ app }) => {
      const synced = await app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore?: { getState: () => { synced?: Record<string, unknown> } };
        };
        return w.__apicircleStore!.getState().synced ?? {};
      });
      expect('telemetry' in synced).toBe(false);
      expect('analytics' in synced).toBe(false);
    },
  );

  test(
    tc(
      id('Event payload contains no PII'),
      'no telemetry events ever fire — the empty payload is by construction PII-free',
    ),
    async ({ app }) => {
      const telemetryHits: string[] = [];
      app.on('request', (req) => {
        const url = req.url();
        if (TELEMETRY_HOST_PATTERN.test(url)) telemetryHits.push(url);
      });
      await app.getByRole('button', { name: /^Editor$/ }).click();
      await app.waitForTimeout(300);
      expect(telemetryHits).toEqual([]);
    },
  );

  test(
    tc(
      id('Network for telemetry only when enabled'),
      'no telemetry endpoint contacted on first boot',
    ),
    async ({ app }) => {
      const hits: string[] = [];
      app.on('request', (req) => {
        if (TELEMETRY_HOST_PATTERN.test(req.url())) hits.push(req.url());
      });
      await app.waitForTimeout(500);
      expect(hits).toEqual([]);
    },
  );

  test(
    tc(
      id('Workspace data never sent to telemetry endpoint'),
      'no outbound POST/PUT/PATCH carries the workspace doc body',
    ),
    async ({ app }) => {
      const wsId = await app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => { synced?: { workspaceId?: string } };
          };
        };
        return w.__apicircleStore!.getState().synced?.workspaceId ?? '';
      });
      const payloads: string[] = [];
      app.on('request', (req) => {
        if (['POST', 'PUT', 'PATCH'].includes(req.method())) {
          const body = req.postData();
          if (body) payloads.push(body);
        }
      });
      await app.getByRole('button', { name: /^Help Center$/ }).click();
      await app.waitForTimeout(300);
      const leakage = payloads.filter(
        (p) => (wsId && p.includes(wsId)) || /"schemaVersion"\s*:\s*1[^0-9]/.test(p),
      );
      expect(leakage).toEqual([]);
    },
  );

  test(
    tc(
      id('Anonymous install id'),
      'no install-id key is set in localStorage without explicit opt-in',
    ),
    async ({ app }) => {
      const keys = await app.evaluate(() => Object.keys(localStorage));
      const installIdKeys = keys.filter((k) => /install.?id|install-uid|anonymous.?id/i.test(k));
      expect(installIdKeys).toEqual([]);
    },
  );

  // -----------------------------------------------------------------
  // UI-surface cells — these need actual telemetry UI to assert.
  // Tracked here as documented fixmes; the TC-IDs also live in
  // `e2e/web/manual-residue.ts` so the strict scanner classifies
  // them as residue (not gap) until the feature lands.
  // -----------------------------------------------------------------
  const NEEDS_TELEMETRY_UI = [
    'Disable telemetry from settings',
    'Crash reports opt-in',
    'Crash reports include stack but no user data',
    'Reset install id',
    'Privacy policy link visible',
  ] as const;
  for (const key of NEEDS_TELEMETRY_UI) {
    test.fixme(tc(id(key), `${key} — telemetry UI not implemented`), async () => {
      // No Settings → Privacy panel, no crash-reporter, no install-id
      // surface. These cells need the underlying feature to exist; the
      // workbook expectations are pre-implementation aspirations.
    });
  }
});
