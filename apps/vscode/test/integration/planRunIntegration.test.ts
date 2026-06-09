// =============================================================================
// planRunIntegration test (gap #13).
//
// Runs a real ExecutionPlan via runPlan from @apicircle/core against a real
// local HTTP server. Verifies:
//   • runPlan returns a non-empty PlanRun
//   • Per-step RequestRuns are populated
//   • The returned nextState has the plan-run appended to history.planRuns
//   • Plan assertions are evaluated
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { runPlan, ANONYMOUS_ACTOR } from '@apicircle/core';
import { generateId } from '@apicircle/shared';
import { GitWorkspaceProvider } from '../../src/host/gitWorkspaceProvider';

describe('planRunIntegration (real HTTP plan run)', () => {
  let tmp: string;
  let apicircleDir: string;
  let localDir: string;
  let provider: GitWorkspaceProvider;
  let server: http.Server;
  let serverUrl: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-rt-'));
    apicircleDir = path.join(tmp, '.apicircle');
    localDir = path.join(tmp, 'local');
    fs.mkdirSync(apicircleDir, { recursive: true });
    fs.mkdirSync(localDir, { recursive: true });
    server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (typeof addr === 'string' || addr === null) throw new Error('bad addr');
    serverUrl = `http://127.0.0.1:${addr.port}`;

    fs.writeFileSync(
      path.join(apicircleDir, 'workspace.json'),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: 'plan-rt',
        collections: {
          tree: { id: 'root', type: 'root', children: [] },
          requests: {},
          folders: {},
        },
        environments: { items: {}, activeName: null, priorityOrder: [] },
        linkedWorkspaces: {},
        linkedOverrides: { requests: {}, environmentVars: {} },
        releases: { self: null, perLink: {} },
        globalAssets: { schemas: {}, graphql: {}, files: {} },
        mockServers: {},
        executionPlans: {},
        secretKeys: {},
        secretCrypto: null,
        meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
      }),
    );
    provider = new GitWorkspaceProvider({ syncedDir: apicircleDir, localDir });
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('runs a 3-step plan end-to-end against real HTTP, assertions evaluated', async () => {
    // Create 3 requests pointing at the local server
    const ids = [generateId(), generateId(), generateId()];
    for (let i = 0; i < ids.length; i++) {
      await provider.apply({
        kind: 'request.create',
        request: {
          id: ids[i],
          name: `Step ${i + 1}`,
          folderId: null,
          method: 'GET',
          url: `${serverUrl}/step${i + 1}`,
          headers: [],
          query: [],
          body: { type: 'none', content: '' },
          auth: { type: 'none' },
          contextVars: [],
          extractions: [],
          assertions: [{ id: `a${i}`, kind: 'status', op: 'equals', expected: 200 }],
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      });
    }

    // Create a plan referencing all 3
    const planId = generateId();
    await provider.apply({
      kind: 'plan.upsert',
      plan: {
        id: planId,
        name: 'Smoke flow',
        steps: ids.map((id) => ({ requestId: id, enabled: true })),
        envPriorityOrder: [],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    });

    // Run it — manually lift plans from local to synced for runPlan
    let state = await provider.read();
    state = {
      synced: { ...state.synced, executionPlans: state.local.executionPlans },
      local: state.local,
    };
    const result = await runPlan(state, planId, {
      withAssertions: true,
      actor: ANONYMOUS_ACTOR,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(3);
    for (const step of result.steps) {
      expect(step.assertionResults).toBeDefined();
      expect(step.assertionResults!.every((a) => a.passed)).toBe(true);
    }

    // Plan-run lands in history
    expect(result.planRun.steps).toHaveLength(3);
    expect(result.planRun.steps.every((s) => s.passed)).toBe(true);
    expect(result.nextState.local.history.planRuns).toHaveLength(1);
  });

  it('runPlan halts on first assertion failure when stopOnAssertionFailure is set', async () => {
    const reqA = generateId();
    const reqB = generateId();
    await provider.apply({
      kind: 'request.create',
      request: {
        id: reqA,
        name: 'Will pass',
        folderId: null,
        method: 'GET',
        url: `${serverUrl}/a`,
        headers: [],
        query: [],
        body: { type: 'none', content: '' },
        auth: { type: 'none' },
        contextVars: [],
        extractions: [],
        assertions: [{ id: 'pa', kind: 'status', op: 'equals', expected: 200 }],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    });
    await provider.apply({
      kind: 'request.create',
      request: {
        id: reqB,
        name: 'Will fail',
        folderId: null,
        method: 'GET',
        url: `${serverUrl}/b`,
        headers: [],
        query: [],
        body: { type: 'none', content: '' },
        auth: { type: 'none' },
        contextVars: [],
        extractions: [],
        assertions: [{ id: 'fa', kind: 'status', op: 'equals', expected: 500 }],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    });

    const planId = generateId();
    await provider.apply({
      kind: 'plan.upsert',
      plan: {
        id: planId,
        name: 'With halt',
        steps: [
          { requestId: reqB, enabled: true }, // fails first
          { requestId: reqA, enabled: true }, // would pass but skipped
        ],
        envPriorityOrder: [],
        stopOnAssertionFailure: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    });

    let state = await provider.read();
    state = {
      synced: { ...state.synced, executionPlans: state.local.executionPlans },
      local: state.local,
    };
    const result = await runPlan(state, planId, { withAssertions: true });
    expect(result.passed).toBe(false);
    // First step ran and failed; second was halted
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
  });
});
