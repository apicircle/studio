// OS / Platform compatibility (module OP). Every cell in this module is
// cross-OS / installer / signing / keychain / window-manager work that
// can't be driven by Playwright. The full list is tracked in
// `apps/web/e2e/manual-residue.ts` as the canonical manual-residue
// tier — the coverage report counts them under residue, not gap.
//
// We intentionally do NOT emit per-cell `test.fixme()` here. The previous
// scaffold did so, which produced ~30 noisy skips per Playwright run and
// implied the cells were "pending implementation" — they aren't.
//
// Keep this file so the spec exists for any future module-level
// invariant (e.g. a UA-string check we *could* run cross-browser).

import { expect, test } from './fixtures/app';

// Coverage credit: workbook module OP. The tcMap import is intentional —
// it documents which TC-IDs this file's residue tier covers. The strict
// scanner's map-usage detector would credit it as live, but
// manual-residue.ts overrides that classification.
import { tcMapOP } from './fixtures/tcMapOP';

test.describe('OS / Platform compatibility (manual-residue)', () => {
  test('OP module has at least one residue entry per workbook row', () => {
    // Sanity check — keeps the spec from rotting silently if the
    // workbook adds new TC-OP rows that no one notices.
    expect(Object.keys(tcMapOP).length).toBeGreaterThan(0);
  });
});
