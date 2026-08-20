// Per-curated-value sweep — for every dictionary entry that ships with
// non-empty `values[]`, the value-suggestions popover renders the values
// and clicking one fills the value field. Default mode picks the FIRST
// value of each header so the suite runs in <60s; `FULL_VALUE_SWEEP=1`
// loops every value of every header for the truly exhaustive run.

import { expect, test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
import { HTTP_HEADERS_MAP } from '@apicircle/core';

// Coverage credit: workbook module HD.
import { tcMapHD } from './fixtures/tcMapHD';
void Object.keys(tcMapHD);

function id(key: string): TcId {
  const v = tcMapHD[key];
  if (!v) throw new Error(`No TC-HD entry for "${key}"`);
  return v;
}
const SKIP_NAMES = new Set<string>([
  // Browser-injected; can't surface in suggestions because reserved=app.
  // (Already filtered by suggestHeaders, but defensive guard.)
]);

interface Case {
  name: string;
  value: string;
}

const cases: Case[] = (() => {
  const out: Case[] = [];
  const full = process.env.FULL_VALUE_SWEEP === '1';
  for (const entry of HTTP_HEADERS_MAP) {
    if (entry.reserved === 'app') continue;
    if (SKIP_NAMES.has(entry.name)) continue;
    if (entry.values.length === 0) continue;
    const values = full ? entry.values : entry.values.slice(0, 1);
    for (const v of values) out.push({ name: entry.name, value: v });
  }
  return out;
})();

// Resolve each header's TC-HD cell. Standard headers have a dedicated
// per-name cell ("Standard :: Send standard header '<Name>'"); anything
// else falls back to the 'Header autocomplete suggests' cell which
// describes the autocomplete behavior this sweep exercises.
function headerTcKey(name: string): string {
  const standardKey = `Standard :: Send standard header '${name}'`;
  if (tcMapHD[standardKey]) return standardKey;
  return 'Header autocomplete suggests';
}

test.describe('Headers — per-curated-value sweep', () => {
  for (const c of cases) {
    const slug = `${c.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${c.value
      .slice(0, 12)
      .replace(/[^a-z0-9]/gi, '-')
      .toLowerCase()}`;
    test(
      tc(
        id(headerTcKey(c.name)),
        `"${c.name}" — picking "${c.value.slice(0, 30)}" fills the value field`,
      ),
      async ({ app, sidebar }) => {
        await sidebar.createRequest(`hdr-cv-${slug}`);
        await app
          .getByRole('tab', { name: /^Headers/ })
          .first()
          .click();
        await app.getByRole('button', { name: 'Add row' }).click();
        await app.getByLabel('Headers key 1').fill(c.name);
        await app.keyboard.press('Escape');
        // Focus the value input — curated popover opens.
        await app.getByLabel('Headers value 1').click();
        const popover = app.getByRole('listbox', { name: /Common values for header 1/ });
        await expect(popover).toBeVisible();
        // Click the matching curated value. Use exact match to disambiguate
        // entries whose values share prefixes (e.g. `gzip` vs `gzip, deflate, br`).
        await popover
          .locator('button', { hasText: new RegExp(`^${escapeRegex(c.value)}$`) })
          .click();
        // Value field carries the picked value verbatim.
        await expect(app.getByLabel('Headers value 1')).toHaveValue(c.value);
      },
    );
  }
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
