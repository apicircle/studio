import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

interface ResponseSpec {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function fakeResponse(spec: ResponseSpec): Response {
  return new Response(JSON.stringify(spec.body), {
    status: spec.status ?? 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
  });
}

function queuedFetch(queue: ResponseSpec[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(async () => {
    if (i >= queue.length) throw new Error(`unexpected fetch call #${i + 1}`);
    return fakeResponse(queue[i++]);
  });
}

describe('workspaceStore.runPlan', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when the plan id is unknown', async () => {
    await expect(useWorkspaceStore.getState().runPlan('nope')).rejects.toThrow(/not found/);
  });

  it('runs each step sequentially and persists planRun + per-step requestRuns to history', async () => {
    // Set up 3 requests pointing at different httpbin-style endpoints. The
    // queued fetch returns one response per request, in order.
    const r1 = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestUrl(r1, 'https://api.example/users');
    const r2 = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestUrl(r2, 'https://api.example/posts');
    const r3 = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestUrl(r3, 'https://api.example/comments');

    const planId = useWorkspaceStore.getState().addPlan('Smoke');
    useWorkspaceStore.getState().addPlanStep(planId, r1);
    useWorkspaceStore.getState().addPlanStep(planId, r2);
    useWorkspaceStore.getState().addPlanStep(planId, r3);

    vi.stubGlobal(
      'fetch',
      queuedFetch([{ body: { ok: 1 } }, { body: { ok: 2 } }, { body: { ok: 3 } }]),
    );

    const planRun = await useWorkspaceStore.getState().runPlan(planId);
    expect(planRun.steps).toHaveLength(3);
    expect(planRun.steps.every((s) => s.passed)).toBe(true);
    expect(planRun.withAssertions).toBe(false);

    const history = useWorkspaceStore.getState().local!.history;
    expect(history.planRuns[0].id).toBe(planRun.id);
    // 3 request runs added to the front of the buffer.
    expect(history.requestRuns.slice(0, 3).map((r) => r.requestId)).toEqual([r3, r2, r1]);
  });

  it('aggregates assertion verdicts when withAssertions is true', async () => {
    const r1 = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestUrl(r1, 'https://api.example/x');
    useWorkspaceStore
      .getState()
      .setRequestAssertions(r1, [{ id: 'a1', kind: 'status', op: 'equals', expected: 200 }]);
    const planId = useWorkspaceStore.getState().addPlan('p');
    useWorkspaceStore.getState().addPlanStep(planId, r1);

    // Server returns 500 — assertion should fail; step.passed becomes false.
    vi.stubGlobal('fetch', queuedFetch([{ body: { err: 1 }, status: 500 }]));
    const planRun = await useWorkspaceStore.getState().runPlan(planId, { withAssertions: true });
    expect(planRun.withAssertions).toBe(true);
    expect(planRun.steps[0].passed).toBe(false);

    const requestRun = useWorkspaceStore.getState().local!.history.requestRuns[0];
    expect(requestRun.assertions).toHaveLength(1);
    expect(requestRun.assertions[0].passed).toBe(false);
  });

  it('records orphan steps (deleted requests) as failures without aborting the rest', async () => {
    const r1 = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestUrl(r1, 'https://api.example/x');
    const orphanId = 'deleted-request-id';
    const planId = useWorkspaceStore.getState().addPlan('p');
    useWorkspaceStore.getState().addPlanStep(planId, orphanId);
    useWorkspaceStore.getState().addPlanStep(planId, r1);

    vi.stubGlobal('fetch', queuedFetch([{ body: { ok: 1 } }]));

    const planRun = await useWorkspaceStore.getState().runPlan(planId);
    expect(planRun.steps).toHaveLength(2);
    expect(planRun.steps[0].passed).toBe(false); // orphan
    expect(planRun.steps[1].passed).toBe(true);
    const orphanRun = useWorkspaceStore
      .getState()
      .local!.history.requestRuns.find((r) => r.requestId === orphanId);
    expect(orphanRun?.error).toMatch(/no longer exists/);
  });

  it('runs a cross-workspace step against a cached linked snapshot', async () => {
    // Stand up a session, link a workspace whose source carries one
    // request + one environment, and then run a plan that references
    // that linked request.
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo' } },
        {
          body: {
            type: 'file',
            path: 'workspace.json',
            sha: 's',
            size: 10,
            content: btoa(
              unescape(
                encodeURIComponent(
                  JSON.stringify({
                    workspaceName: 'Linked',
                    collections: {
                      tree: { id: 'r', type: 'root', children: ['linked-req'] },
                      requests: {
                        'linked-req': {
                          id: 'linked-req',
                          name: 'Greet',
                          folderId: null,
                          method: 'GET',
                          url: '{{BASE_URL}}/hello',
                          headers: [],
                          query: [],
                          body: { type: 'none', content: '' },
                          contextVars: [],
                          assertions: [],
                          createdAt: 't',
                          updatedAt: 't',
                        },
                      },
                      folders: {},
                    },
                    environments: {
                      items: {
                        prod: {
                          name: 'prod',
                          variables: [{ key: 'BASE_URL', value: 'https://prod', encrypted: false }],
                        },
                      },
                      activeName: 'prod',
                      priorityOrder: ['prod'],
                    },
                    releases: { self: null },
                  }),
                ),
              ),
            ),
            encoding: 'base64',
          },
        },
      ]),
    );
    await useWorkspaceStore.getState().connectGitHubSession('tok');
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'org/api', branch: 'main' });
    vi.unstubAllGlobals();

    // Build a plan where the step targets the linked request explicitly.
    const planId = useWorkspaceStore.getState().addPlan('cross');
    useWorkspaceStore.getState().addPlanStep(planId, 'linked-req');
    // The store action doesn't currently take linkedWorkspaceId, so wire
    // it directly through commitLocal — the executor reads it from the
    // step record either way.
    const local = useWorkspaceStore.getState().local!;
    const updated = {
      ...local,
      executionPlans: {
        ...local.executionPlans,
        [planId]: {
          ...local.executionPlans[planId],
          steps: [{ requestId: 'linked-req', linkedWorkspaceId: link.id }],
        },
      },
    };
    useWorkspaceStore.setState({ local: updated });

    const fetchMock = queuedFetch([{ body: { ok: 1 } }]);
    vi.stubGlobal('fetch', fetchMock);
    const planRun = await useWorkspaceStore.getState().runPlan(planId);
    expect(planRun.steps[0].passed).toBe(true);

    // The URL the executor sent uses the LINKED workspace's BASE_URL,
    // not the consumer's (which has none).
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url.startsWith('https://prod')).toBe(true);
  });

  it('records orphan failure when a linked step has no cached snapshot', async () => {
    // Build a plan with a linked step but no actual linked workspace —
    // simulates the case where the user pulled a workspace whose plans
    // reference a link they haven't materialized yet.
    const planId = useWorkspaceStore.getState().addPlan('p');
    const local = useWorkspaceStore.getState().local!;
    useWorkspaceStore.setState({
      local: {
        ...local,
        executionPlans: {
          ...local.executionPlans,
          [planId]: {
            ...local.executionPlans[planId],
            steps: [{ requestId: 'whatever', linkedWorkspaceId: 'phantom-link' }],
          },
        },
      },
    });

    const planRun = await useWorkspaceStore.getState().runPlan(planId);
    expect(planRun.steps[0].passed).toBe(false);
    const orphan = useWorkspaceStore.getState().local!.history.requestRuns[0];
    expect(orphan.error).toMatch(/Linked workspace was unlinked/);
  });

  it('honors plan-level env priority during runs', async () => {
    // Two envs: dev sets BASE_URL=https://dev, prod sets BASE_URL=https://prod.
    // Workspace priority = ['dev'], plan priority = ['prod'] → BASE_URL
    // resolves to prod's value.
    useWorkspaceStore.getState().addEnvironment('dev');
    useWorkspaceStore
      .getState()
      .setVariables('dev', [{ key: 'BASE_URL', value: 'https://dev', encrypted: false }]);
    useWorkspaceStore.getState().addEnvironment('prod');
    useWorkspaceStore
      .getState()
      .setVariables('prod', [{ key: 'BASE_URL', value: 'https://prod', encrypted: false }]);
    useWorkspaceStore.getState().setPriorityOrder(['dev']);

    const r1 = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestUrl(r1, '{{BASE_URL}}/users');
    const planId = useWorkspaceStore.getState().addPlan('p');
    useWorkspaceStore.getState().addPlanStep(planId, r1);
    useWorkspaceStore.getState().setPlanEnvPriority(planId, ['prod']);

    const fetchMock = queuedFetch([{ body: { ok: 1 } }]);
    vi.stubGlobal('fetch', fetchMock);
    await useWorkspaceStore.getState().runPlan(planId);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url.startsWith('https://prod')).toBe(true);
  });
});
