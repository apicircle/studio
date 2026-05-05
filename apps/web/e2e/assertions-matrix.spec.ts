// Assertion matrix — each (kind, op) combination exercised against the
// mock server with both pass and fail paths. The Editor's response
// Assertions tab renders the explanation string for each verdict; we
// assert on that text via the runAssertions output format.
//
// Mock-server endpoints used:
//   /status/200    → status=200
//   /status/500    → status=500
//   /delay/120     → durationMs ~ 120 (passes lt:500, gt:50)
//   /json          → fixed tree { id: 42, name: 'alice', scores: [10,20,30] }

import { expect, test } from './fixtures/app';

interface Case {
  name: string;
  kind: 'status' | 'duration' | 'header' | 'json-path';
  op: 'equals' | 'not-equals' | 'lt' | 'gt' | 'contains' | 'matches';
  target?: string;
  expected: string | number;
  url: (mockUrl: (p: string) => string) => string;
  shouldPass: boolean;
  passDetail?: RegExp;
  failDetail?: RegExp;
}

const cases: Case[] = [
  // status
  {
    name: 'status equals → pass',
    kind: 'status',
    op: 'equals',
    expected: 200,
    url: (m) => m('/status/200'),
    shouldPass: true,
    passDetail: /status: 200 equals 200/,
  },
  {
    name: 'status equals → fail',
    kind: 'status',
    op: 'equals',
    expected: 200,
    url: (m) => m('/status/500'),
    shouldPass: false,
    failDetail: /expected 200, got 500/,
  },
  {
    name: 'status not-equals → pass',
    kind: 'status',
    op: 'not-equals',
    expected: 500,
    url: (m) => m('/status/200'),
    shouldPass: true,
    passDetail: /200 does not equal 500/,
  },
  {
    name: 'status not-equals → fail',
    kind: 'status',
    op: 'not-equals',
    expected: 200,
    url: (m) => m('/status/200'),
    shouldPass: false,
    failDetail: /expected not to equal 200/,
  },
  {
    name: 'status lt → pass',
    kind: 'status',
    op: 'lt',
    expected: 300,
    url: (m) => m('/status/200'),
    shouldPass: true,
    passDetail: /200 < 300/,
  },
  {
    name: 'status lt → fail',
    kind: 'status',
    op: 'lt',
    expected: 300,
    url: (m) => m('/status/500'),
    shouldPass: false,
    failDetail: /expected < 300, got 500/,
  },
  {
    name: 'status gt → pass',
    kind: 'status',
    op: 'gt',
    expected: 199,
    url: (m) => m('/status/200'),
    shouldPass: true,
    passDetail: /200 > 199/,
  },
  {
    name: 'status gt → fail',
    kind: 'status',
    op: 'gt',
    expected: 500,
    url: (m) => m('/status/200'),
    shouldPass: false,
    failDetail: /expected > 500, got 200/,
  },

  // duration
  {
    name: 'duration lt → pass',
    kind: 'duration',
    op: 'lt',
    expected: 5000,
    url: (m) => m('/delay/50'),
    shouldPass: true,
    passDetail: /duration: \d+ < 5000/,
  },
  {
    name: 'duration gt → pass',
    kind: 'duration',
    op: 'gt',
    expected: 1,
    url: (m) => m('/delay/50'),
    shouldPass: true,
    passDetail: /duration: \d+ > 1/,
  },
  {
    name: 'duration lt → fail',
    kind: 'duration',
    op: 'lt',
    expected: 1,
    url: (m) => m('/delay/200'),
    shouldPass: false,
    failDetail: /expected < 1, got \d+/,
  },

  // header
  {
    name: 'header equals → pass',
    kind: 'header',
    op: 'equals',
    target: 'content-type',
    expected: 'application/json',
    url: (m) => m('/json'),
    shouldPass: true,
    passDetail: /header "content-type":/,
  },
  {
    name: 'header equals → fail',
    kind: 'header',
    op: 'equals',
    target: 'content-type',
    expected: 'text/plain',
    url: (m) => m('/json'),
    shouldPass: false,
    failDetail: /expected "text\/plain"/,
  },
  {
    name: 'header not-equals → pass on missing',
    kind: 'header',
    op: 'not-equals',
    target: 'x-missing',
    expected: 'anything',
    url: (m) => m('/json'),
    shouldPass: true,
    passDetail: /not present \(passes not-equals\)/,
  },
  {
    name: 'header contains → pass',
    kind: 'header',
    op: 'contains',
    target: 'content-type',
    expected: 'json',
    url: (m) => m('/json'),
    shouldPass: true,
    passDetail: /contains "json"/,
  },
  {
    name: 'header matches → pass',
    kind: 'header',
    op: 'matches',
    target: 'content-type',
    expected: '^application/',
    url: (m) => m('/json'),
    shouldPass: true,
    passDetail: /matches \/\^application\//,
  },

  // json-path
  {
    name: 'json-path equals → pass (numeric)',
    kind: 'json-path',
    op: 'equals',
    target: 'id',
    expected: 42,
    url: (m) => m('/json'),
    shouldPass: true,
    passDetail: /path "id": 42 equals 42/,
  },
  {
    name: 'json-path equals → fail',
    kind: 'json-path',
    op: 'equals',
    target: 'id',
    expected: 99,
    url: (m) => m('/json'),
    shouldPass: false,
    failDetail: /expected 99, got 42/,
  },
  {
    name: 'json-path contains → pass (string)',
    kind: 'json-path',
    op: 'contains',
    target: 'name',
    expected: 'lic',
    url: (m) => m('/json'),
    shouldPass: true,
    passDetail: /"alice" contains "lic"/,
  },
  {
    name: 'json-path matches → pass',
    kind: 'json-path',
    op: 'matches',
    target: 'name',
    expected: '^al',
    url: (m) => m('/json'),
    shouldPass: true,
    passDetail: /matches \/\^al\//,
  },
  {
    name: 'json-path not-equals → pass on missing',
    kind: 'json-path',
    op: 'not-equals',
    target: 'missing',
    expected: 'x',
    url: (m) => m('/json'),
    shouldPass: true,
    passDetail: /not found \(passes not-equals\)/,
  },
  {
    name: 'json-path lt → pass (numeric)',
    kind: 'json-path',
    op: 'lt',
    expected: 100,
    target: 'id',
    url: (m) => m('/json'),
    shouldPass: true,
    passDetail: /42 < 100/,
  },
  {
    name: 'json-path gt → pass (numeric)',
    kind: 'json-path',
    op: 'gt',
    expected: 1,
    target: 'id',
    url: (m) => m('/json'),
    shouldPass: true,
    passDetail: /42 > 1/,
  },

  // unsupported combinations — confirm they emit a clear failure.
  {
    name: 'numeric kind + contains → unsupported',
    kind: 'status',
    op: 'contains',
    expected: '20',
    url: (m) => m('/status/200'),
    shouldPass: false,
    failDetail: /op "contains" not supported for numeric values/,
  },
  {
    name: 'string kind + lt → unsupported',
    kind: 'header',
    op: 'lt',
    target: 'content-type',
    expected: 'json',
    url: (m) => m('/json'),
    shouldPass: false,
    failDetail: /op "lt" not supported for string values/,
  },
];

test.describe('Assertion matrix', () => {
  for (const c of cases) {
    test(c.name, async ({ app, e2eMock, sidebar }) => {
      const slug = c.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .slice(0, 40);
      await sidebar.createRequest(`a-${slug}`);
      await app.getByLabel('Request URL').fill(c.url(e2eMock.url));

      // Open Assertions tab + add an assertion.
      await app
        .getByRole('button', { name: /^Assertions/ })
        .first()
        .click();
      await app.getByRole('button', { name: /^Add assertion$/ }).click();

      // Configure kind, op, target, expected.
      await app.getByLabel('Assertion 1 kind').selectOption(c.kind);
      await app.getByLabel('Assertion 1 op').selectOption(c.op);
      if (c.target !== undefined) {
        await app.getByLabel('Assertion 1 target').fill(c.target);
      }
      await app.getByLabel('Assertion 1 expected').fill(String(c.expected));

      // Send.
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText(/^\d{3}/).first()).toBeVisible();

      // Click the response's Assertions tab to surface the explanation.
      const responseTab = app
        .getByRole('button', { name: /^Assertions/ })
        .filter({ hasText: c.shouldPass ? '(1/1)' : '(0/1)' });
      await responseTab.click();

      const expectedText = c.shouldPass ? c.passDetail! : c.failDetail!;
      await expect(app.getByText(expectedText).first()).toBeVisible();
    });
  }
});
