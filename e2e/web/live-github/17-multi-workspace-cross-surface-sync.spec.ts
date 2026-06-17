// Multi-workspace cross-surface sync — live GitHub E2E.
//
// Verifies that edits made on one surface (VS Code, Web App, Desktop App)
// are visible on the other two when the shared medium is a Git-backed repo
// containing MULTIPLE workspaces under `.apicircle/`.
//
// Surface simulation model:
//   VS Code  = GitHub Contents API write/read (simulates git commit + push / pull)
//   Web App  = Playwright-driven web app (real connectRepo / push / refresh)
//   Desktop  = GitHub Contents API write/read (simulates disk mirror + git sync)
//
// Each test creates an ephemeral repo with 2 workspaces (Alpha + Beta),
// mutates one workspace on one surface, and asserts the change is visible
// from the other surfaces — and that the sibling workspace is untouched.

import { expect, test } from '../fixtures/app';
import {
  connectAndBranchV2,
  createV2MultiWorkspaceHostRepo,
  createV2Tracker,
  disconnectV2,
  getV2BotConfig,
  makeV2BranchName,
  v2SkipReason,
} from './_helpers';
import {
  fetchRegistryJson,
  fetchWorkspaceJsonById,
  makeDeterministicWorkspace,
  updateWorkspaceJsonById,
} from './_github-rest';

// ---------------------------------------------------------------------------
// Workspace factory — deterministic Alpha + Beta content with distinct URLs
// so assertions can tell which workspace they're reading.
// ---------------------------------------------------------------------------

const ALPHA_ID = 'e2e-alpha-workspace';
const BETA_ID = 'e2e-beta-workspace';

function makeAlphaWorkspace(): Record<string, unknown> {
  return makeDeterministicWorkspace('alpha', {
    requestUrl: 'https://alpha.example.test/users',
    envValue: 'https://env.alpha.example.test',
    version: '1.0.0',
    notes: '# Alpha v1\n\n- Seeded by multi-workspace E2E.',
  });
}

function makeBetaWorkspace(): Record<string, unknown> {
  return makeDeterministicWorkspace('beta', {
    requestUrl: 'https://beta.example.test/orders',
    envValue: 'https://env.beta.example.test',
    version: '1.0.0',
    notes: '# Beta v1\n\n- Seeded by multi-workspace E2E.',
  });
}

function multiWorkspaceSeeds(): Array<{
  id: string;
  name: string;
  content: Record<string, unknown>;
}> {
  return [
    { id: ALPHA_ID, name: 'Alpha', content: makeAlphaWorkspace() },
    { id: BETA_ID, name: 'Beta', content: makeBetaWorkspace() },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Live GitHub - multi-workspace cross-surface sync @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async ({ app }) => {
    await disconnectV2(app);
    await tracker.cleanup();
  });

  // ---- Test 1: VS Code → Web App ----
  test('VS Code edits workspace-alpha, Web App refreshes and sees the change', async ({ app }) => {
    const bot = getV2BotConfig();
    const host = await createV2MultiWorkspaceHostRepo(
      tracker,
      bot,
      'vsc-to-web',
      multiWorkspaceSeeds(),
      ALPHA_ID,
    );
    const branch = makeV2BranchName(test.info().workerIndex, 'vsc-to-web');

    // Web App connects and creates working branch (inherits both workspaces from main).
    await connectAndBranchV2(app, host, branch, tracker);

    // Simulate VS Code: edit workspace-alpha (add a new request) and push to the branch.
    await updateWorkspaceJsonById(
      host,
      branch,
      ALPHA_ID,
      'e2e: VS Code adds vscode-request to alpha',
      (ws: Record<string, any>) => {
        const reqId = 'vscode-added-request';
        ws.collections.requests[reqId] = {
          id: reqId,
          name: 'VS Code Added Request',
          folderId: null,
          method: 'PUT',
          url: 'https://vscode.example.test/alpha/from-vscode',
          headers: [{ key: 'X-Source', value: 'vscode', enabled: true }],
          query: [],
          pathParams: {},
          cookies: [],
          body: { type: 'json', content: '{"source":"vscode"}' },
          auth: { type: 'none' },
          contextVars: [],
          extractions: [],
          assertions: [],
          createdAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
        };
        ws.collections.tree.children.push({ kind: 'request', id: reqId });
      },
    );

    // Web App refreshes (pulls from the working branch).
    const refreshResult = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      return api.refreshWorkspace();
    });
    expect(refreshResult.status).toBeTruthy();

    // Assert the VS Code change is visible in the Web App.
    const webState = await app.evaluate(() => {
      const state = window.__apicircleStore!.getState() as any;
      const requests = state.synced?.collections?.requests ?? {};
      return {
        requestNames: Object.values(requests).map((r: any) => r.name),
        requestUrls: Object.values(requests).map((r: any) => r.url),
        requestCount: Object.keys(requests).length,
      };
    });
    expect(webState.requestNames).toContain('VS Code Added Request');
    expect(webState.requestUrls).toContain('https://vscode.example.test/alpha/from-vscode');
    expect(webState.requestCount).toBe(2); // original + VS Code added

    // Workspace-beta should be untouched on the branch.
    const betaFile = await fetchWorkspaceJsonById(host, branch, BETA_ID);
    const betaRequests = (betaFile.json as any).collections?.requests ?? {};
    expect(Object.keys(betaRequests)).toHaveLength(1); // only the original seed request
    expect(JSON.stringify(betaFile.json)).toContain('https://beta.example.test/orders');
    expect(JSON.stringify(betaFile.json)).not.toContain('vscode');
  });

  // ---- Test 2: Web App → VS Code + Desktop ----
  test('Web App edits workspace-alpha and pushes, VS Code and Desktop read the change', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2MultiWorkspaceHostRepo(
      tracker,
      bot,
      'web-to-others',
      multiWorkspaceSeeds(),
      ALPHA_ID,
    );
    const branch = makeV2BranchName(test.info().workerIndex, 'web-to-others');

    await connectAndBranchV2(app, host, branch, tracker);

    // Web App: add a request to workspace-alpha.
    await app.evaluate(() => {
      const api = window.__apicircleStore!.getState() as any;
      const requestId = api.addRequest(null, 'Web App Added Request');
      api.setRequestMethod(requestId, 'PATCH');
      api.setRequestUrl(requestId, 'https://webapp.example.test/alpha/from-web');
      api.setRequestBody(requestId, { type: 'json', content: '{"source":"webapp"}' });
    });

    // Web App pushes.
    const pushed = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      return api.pushWorkspace('e2e: Web App adds request to alpha');
    });
    expect(pushed.commitSha).toMatch(/^[a-f0-9]{40}$/);

    // Simulate VS Code reading workspace-alpha (git pull).
    const alphaForVscode = await fetchWorkspaceJsonById(host, branch, ALPHA_ID, {
      expectedCommitSha: pushed.commitSha,
    });
    const vscodeRequests = (alphaForVscode.json as any).collections?.requests ?? {};
    const vscodeRequestNames = Object.values(vscodeRequests).map((r: any) => r.name);
    expect(vscodeRequestNames).toContain('Web App Added Request');
    expect(JSON.stringify(alphaForVscode.json)).toContain(
      'https://webapp.example.test/alpha/from-web',
    );

    // Simulate Desktop reading workspace-alpha (git pull / disk mirror read).
    // Same fetch — Desktop and VS Code both read the same Git tree.
    const alphaForDesktop = await fetchWorkspaceJsonById(host, branch, ALPHA_ID, {
      expectedCommitSha: pushed.commitSha,
    });
    expect(JSON.stringify(alphaForDesktop.json)).toContain('Web App Added Request');

    // Workspace-beta should be untouched.
    const betaFile = await fetchWorkspaceJsonById(host, branch, BETA_ID);
    const betaReqs = (betaFile.json as any).collections?.requests ?? {};
    expect(Object.keys(betaReqs)).toHaveLength(1);
    expect(JSON.stringify(betaFile.json)).not.toContain('webapp');
  });

  // ---- Test 3: Desktop → Web App ----
  test('Desktop edits workspace-alpha, Web App refreshes and sees the change', async ({ app }) => {
    const bot = getV2BotConfig();
    const host = await createV2MultiWorkspaceHostRepo(
      tracker,
      bot,
      'desk-to-web',
      multiWorkspaceSeeds(),
      ALPHA_ID,
    );
    const branch = makeV2BranchName(test.info().workerIndex, 'desk-to-web');

    await connectAndBranchV2(app, host, branch, tracker);

    // Simulate Desktop: edit workspace-alpha (add a request) and push.
    await updateWorkspaceJsonById(
      host,
      branch,
      ALPHA_ID,
      'e2e: Desktop adds desktop-request to alpha',
      (ws: Record<string, any>) => {
        const reqId = 'desktop-added-request';
        ws.collections.requests[reqId] = {
          id: reqId,
          name: 'Desktop Added Request',
          folderId: null,
          method: 'DELETE',
          url: 'https://desktop.example.test/alpha/from-desktop',
          headers: [{ key: 'X-Source', value: 'desktop', enabled: true }],
          query: [],
          pathParams: {},
          cookies: [],
          body: { type: 'none', content: '' },
          auth: { type: 'none' },
          contextVars: [],
          extractions: [],
          assertions: [],
          createdAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
        };
        ws.collections.tree.children.push({ kind: 'request', id: reqId });
      },
    );

    // Web App refreshes to pull Desktop changes.
    await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      await api.refreshWorkspace();
    });

    // Assert the Desktop change is visible in the Web App.
    const webState = await app.evaluate(() => {
      const state = window.__apicircleStore!.getState() as any;
      const requests = state.synced?.collections?.requests ?? {};
      return {
        requestNames: Object.values(requests).map((r: any) => r.name),
        requestUrls: Object.values(requests).map((r: any) => r.url),
      };
    });
    expect(webState.requestNames).toContain('Desktop Added Request');
    expect(webState.requestUrls).toContain('https://desktop.example.test/alpha/from-desktop');
  });

  // ---- Test 4: VS Code edits workspace-beta, Desktop reads (workspace-alpha isolation) ----
  test('VS Code edits workspace-beta, Desktop reads it, workspace-alpha untouched', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2MultiWorkspaceHostRepo(
      tracker,
      bot,
      'beta-iso',
      multiWorkspaceSeeds(),
      ALPHA_ID,
    );
    const branch = makeV2BranchName(test.info().workerIndex, 'beta-iso');

    // Create the branch via the web app (even though we're testing beta,
    // we need a branch to write to).
    await connectAndBranchV2(app, host, branch, tracker);

    // Simulate VS Code: edit workspace-beta (add an environment variable).
    await updateWorkspaceJsonById(
      host,
      branch,
      BETA_ID,
      'e2e: VS Code adds env var to beta',
      (ws: Record<string, any>) => {
        const envName = Object.keys(ws.environments.items)[0];
        if (envName) {
          ws.environments.items[envName].variables.push({
            key: 'VSCODE_INJECTED',
            value: 'from-vscode-to-beta',
            encrypted: false,
          });
        }
      },
    );

    // Simulate Desktop reading workspace-beta.
    const betaForDesktop = await fetchWorkspaceJsonById(host, branch, BETA_ID);
    const betaEnv = Object.values((betaForDesktop.json as any).environments?.items ?? {})[0] as any;
    const varKeys = (betaEnv?.variables ?? []).map((v: any) => v.key);
    expect(varKeys).toContain('VSCODE_INJECTED');

    // Workspace-alpha must be untouched.
    const alphaFile = await fetchWorkspaceJsonById(host, branch, ALPHA_ID);
    const alphaText = JSON.stringify(alphaFile.json);
    expect(alphaText).not.toContain('VSCODE_INJECTED');
    expect(alphaText).toContain('https://alpha.example.test/users');
  });

  // ---- Test 5: Three-surface round-trip on workspace-alpha ----
  test('three-surface round-trip: VS Code → Web → Desktop on workspace-alpha', async ({ app }) => {
    const bot = getV2BotConfig();
    const host = await createV2MultiWorkspaceHostRepo(
      tracker,
      bot,
      'round-trip',
      multiWorkspaceSeeds(),
      ALPHA_ID,
    );
    const branch = makeV2BranchName(test.info().workerIndex, 'round-trip');

    await connectAndBranchV2(app, host, branch, tracker);

    // Step 1: VS Code adds request-1.
    await updateWorkspaceJsonById(
      host,
      branch,
      ALPHA_ID,
      'e2e: VS Code adds request-1',
      (ws: Record<string, any>) => {
        ws.collections.requests['rt-req-1'] = {
          id: 'rt-req-1',
          name: 'Round Trip Request 1 (VS Code)',
          folderId: null,
          method: 'GET',
          url: 'https://roundtrip.example.test/1',
          headers: [],
          query: [],
          pathParams: {},
          cookies: [],
          body: { type: 'none', content: '' },
          auth: { type: 'none' },
          contextVars: [],
          extractions: [],
          assertions: [],
          createdAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
        };
        ws.collections.tree.children.push({ kind: 'request', id: 'rt-req-1' });
      },
    );

    // Step 2: Web App refreshes, sees request-1, adds request-2, pushes.
    await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      await api.refreshWorkspace();
    });

    const afterVscodeWrite = await app.evaluate(() => {
      const state = window.__apicircleStore!.getState() as any;
      return Object.values(state.synced?.collections?.requests ?? {}).map((r: any) => r.name);
    });
    expect(afterVscodeWrite).toContain('Round Trip Request 1 (VS Code)');

    // Web App adds request-2.
    await app.evaluate(() => {
      const api = window.__apicircleStore!.getState() as any;
      const id = api.addRequest(null, 'Round Trip Request 2 (Web)');
      api.setRequestMethod(id, 'POST');
      api.setRequestUrl(id, 'https://roundtrip.example.test/2');
    });

    const pushed = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      return api.pushWorkspace('e2e: Web App adds request-2');
    });
    expect(pushed.commitSha).toMatch(/^[a-f0-9]{40}$/);

    // Step 3: Desktop reads workspace-alpha — should see request-1 + request-2.
    const alphaForDesktop = await fetchWorkspaceJsonById(host, branch, ALPHA_ID, {
      expectedCommitSha: pushed.commitSha,
    });
    const desktopRequestNames = Object.values(
      (alphaForDesktop.json as any).collections?.requests ?? {},
    ).map((r: any) => r.name);
    expect(desktopRequestNames).toContain('Round Trip Request 1 (VS Code)');
    expect(desktopRequestNames).toContain('Round Trip Request 2 (Web)');

    // Step 4: Desktop adds request-3.
    await updateWorkspaceJsonById(
      host,
      branch,
      ALPHA_ID,
      'e2e: Desktop adds request-3',
      (ws: Record<string, any>) => {
        ws.collections.requests['rt-req-3'] = {
          id: 'rt-req-3',
          name: 'Round Trip Request 3 (Desktop)',
          folderId: null,
          method: 'PATCH',
          url: 'https://roundtrip.example.test/3',
          headers: [],
          query: [],
          pathParams: {},
          cookies: [],
          body: { type: 'json', content: '{"step":3}' },
          auth: { type: 'none' },
          contextVars: [],
          extractions: [],
          assertions: [],
          createdAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
        };
        ws.collections.tree.children.push({ kind: 'request', id: 'rt-req-3' });
      },
    );

    // Step 5: Web App refreshes — should see all three requests.
    await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      await api.refreshWorkspace();
    });

    const finalWebState = await app.evaluate(() => {
      const state = window.__apicircleStore!.getState() as any;
      return Object.values(state.synced?.collections?.requests ?? {}).map((r: any) => r.name);
    });
    expect(finalWebState).toContain('Round Trip Request 1 (VS Code)');
    expect(finalWebState).toContain('Round Trip Request 2 (Web)');
    expect(finalWebState).toContain('Round Trip Request 3 (Desktop)');

    // Step 6: VS Code reads — should also see all three.
    const alphaForVscode = await fetchWorkspaceJsonById(host, branch, ALPHA_ID);
    const vscodeNames = Object.values((alphaForVscode.json as any).collections?.requests ?? {}).map(
      (r: any) => r.name,
    );
    expect(vscodeNames).toContain('Round Trip Request 1 (VS Code)');
    expect(vscodeNames).toContain('Round Trip Request 2 (Web)');
    expect(vscodeNames).toContain('Round Trip Request 3 (Desktop)');

    // Workspace-beta untouched throughout.
    const betaFile = await fetchWorkspaceJsonById(host, branch, BETA_ID);
    const betaReqs = (betaFile.json as any).collections?.requests ?? {};
    expect(Object.keys(betaReqs)).toHaveLength(1);
    expect(JSON.stringify(betaFile.json)).not.toContain('roundtrip');
  });

  // ---- Test 6: Registry integrity after multi-surface writes ----
  test('registry.json stays consistent after multi-workspace writes', async ({ app }) => {
    const bot = getV2BotConfig();
    const host = await createV2MultiWorkspaceHostRepo(
      tracker,
      bot,
      'reg-integrity',
      multiWorkspaceSeeds(),
      ALPHA_ID,
    );
    const branch = makeV2BranchName(test.info().workerIndex, 'reg-integrity');

    await connectAndBranchV2(app, host, branch, tracker);

    // VS Code writes to workspace-alpha.
    await updateWorkspaceJsonById(
      host,
      branch,
      ALPHA_ID,
      'e2e: VS Code edits alpha',
      (ws: Record<string, any>) => {
        ws.meta.updatedAt = new Date().toISOString();
      },
    );

    // Desktop writes to workspace-beta.
    await updateWorkspaceJsonById(
      host,
      branch,
      BETA_ID,
      'e2e: Desktop edits beta',
      (ws: Record<string, any>) => {
        ws.meta.updatedAt = new Date().toISOString();
      },
    );

    // Web App pushes workspace-alpha.
    await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      await api.refreshWorkspace();
    });
    await app.evaluate(() => {
      const api = window.__apicircleStore!.getState() as any;
      api.addRequest(null, 'Registry Integrity Request');
    });
    const pushed = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      return api.pushWorkspace('e2e: Web App pushes alpha');
    });
    expect(pushed.commitSha).toMatch(/^[a-f0-9]{40}$/);

    // Verify registry still lists both workspaces.
    const registry = await fetchRegistryJson(host, branch);
    expect(registry.workspaces).toHaveLength(2);
    const registryIds = registry.workspaces.map((w) => w.id).sort();
    expect(registryIds).toEqual([ALPHA_ID, BETA_ID].sort());
    expect(registry.activeWorkspaceId).toBe(ALPHA_ID);

    // Both workspace.json files should still be readable.
    const alphaFile = await fetchWorkspaceJsonById(host, branch, ALPHA_ID);
    const betaFile = await fetchWorkspaceJsonById(host, branch, BETA_ID);
    expect((alphaFile.json as any).workspaceId).toBe(ALPHA_ID);
    expect((betaFile.json as any).workspaceId).toBe(BETA_ID);
  });
});
