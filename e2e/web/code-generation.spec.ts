// Code Generation (TC-CG-*) — 242 manual cases covering the per-
// language matrix (curl, fetch, axios, httpx, requests, OkHttp, etc.).
//
// **Implementation status:** the product exposes code generation only
// through the MCP server's `generate.code` tool (see Help Center →
// "MCP Server" section in `packages/ui-components/src/panels/help/
// helpContent.ts`). There is NO web-UI panel that drives codegen.
//
// The MCP tool's happy-path + validation paths are exercised in
// `e2e/desktop/mcp.spec.ts` (`generate.code` describe block) under
// TC-MC IDs. The per-language matrix cells (TC-CG-*) live in
// `e2e/web/manual-residue.ts` until a web UI surface exposes
// codegen — at which point each cell lifts from residue to a real
// per-language assertion.

import { test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapCG } from './fixtures/tcMapCG';
import type { TcId } from './fixtures/tcCoverage';

void Object.keys(tcMapCG);

function id(key: string): TcId {
  const v = tcMapCG[key];
  if (!v) throw new Error(`No TC-CG entry for "${key}"`);
  return v;
}

test.describe('Code Generation — residue (no web UI)', () => {
  // Anchor test that exercises the helper so the spec is alive in CI.
  test.fixme(
    tc(
      id('curl :: Codegen curl: Simple GET'),
      'Codegen has no web-UI surface — see e2e/desktop/mcp.spec.ts generate.code',
    ),
    async () => {
      // When the web UI gains a Code Generation panel, replace this
      // fixme with a real test that drives the panel and asserts the
      // generated curl string contains the expected method + URL.
    },
  );
});
