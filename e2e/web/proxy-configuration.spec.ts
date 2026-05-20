// Proxy configuration cells (TC-PR-*). The browser context owns proxy
// routing — Playwright supports `contextOptions.proxy`, but the workbook
// asserts the app's own proxy-config surface (manual proxy, PAC, system
// proxy, NTLM, etc.). For the web build that surface is browser-default,
// so most TC-PR rows live in the desktop suite.
//
// For the web suite we can fill a handful when a localhost HTTP proxy
// fixture is wired up — currently absent. Stays scaffolded.

import { test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapPR } from './fixtures/tcMapPR';

test.describe('Proxy configuration — pending proxy fixture', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const [key, tcId] of Object.entries(tcMapPR)) {
    test.fixme(tc(tcId, key), async () => {
      // Needs a localhost HTTP proxy fixture (e.g. http-proxy spawn) +
      // app-side proxy override that the test can flip per-request.
      // See docs/qa/README.md (Pending).
    });
  }
});
