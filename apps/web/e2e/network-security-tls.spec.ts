// TLS / network security cells (TC-NS-*). Every TC-NS row depends on a
// real TLS listener with a known cert posture (valid, self-signed,
// expired, revoked, hostname-mismatch, mTLS, etc.). The e2e-mock server
// is HTTP-only today; spinning up a sibling node:https listener with
// `selfsigned` + a static cert bundle is an S5 follow-up.
//
// The cells stay scaffolded (fixme'd) with one rationale: "TLS sibling
// server pending". When the sibling lands, replace this file with real
// assertions against `https://localhost:5177/...` etc.

import { test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapNS } from './fixtures/tcMapNS';

test.describe('TLS / network security — pending TLS fixture', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const [key, tcId] of Object.entries(tcMapNS)) {
    test.fixme(tc(tcId, key), async () => {
      // Needs `apps/e2e-mock` to host a sibling node:https listener
      // with a known cert posture. See E2E-AUTOMATION-PLAN.md S5.
    });
  }
});
