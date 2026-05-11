import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';
import { serializeWorkspaceForGit } from '@apicircle/core';
import type { WorkspaceSynced } from '@apicircle/shared';

// "Switch workspace" / "clone scenario" — the user's report:
//
//   First workspace creates collections, requests, environments,
//   execution plans, mock servers, and a linked-workspace pointer.
//   They push everything to main. They open Second workspace, connect
//   to the same repo, and expect to see all of it without manual
//   re-entry.
//
// Pre-fix gaps (from the audit):
//   1. executionPlans lived on WorkspaceLocal — never serialized to
//      Git → second workspace saw zero plans.
//   2. linkedCollections (the cached snapshot) is local-only and
//      refreshLinkedWorkspace only updated the ledger, not the
//      snapshot → second workspace saw the link metadata but no
//      requests/envs from the source even after clicking Refresh.
//   3. mockServers were already on synced (round-trip works) but the
//      user reported missing — covered here as a regression guard.
//
// These tests assert the post-fix behavior end-to-end through the
// store: produce a workspace.json the way push would, simulate fresh
// hydration of a second workspace whose initial pull returns that
// JSON, and verify all the team-shared content lands.

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
    if (i >= queue.length) throw new Error(`unexpected fetch #${i + 1} — queue exhausted`);
    return fakeResponse(queue[i++]);
  });
}

function fileContents(json: string): ResponseSpec {
  // Serializer pipes through git as raw text, but the GitHub Contents
  // API base64-encodes it — match that wire shape so getContents
  // decodes correctly.
  const content = btoa(unescape(encodeURIComponent(json)));
  return {
    body: {
      type: 'file',
      path: 'workspace.json',
      sha: 'remote-sha',
      size: json.length,
      content,
      encoding: 'base64',
    },
  };
}

beforeEach(async () => {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Connects a real workspace GitHub session so `decryptSessionToken`
 * can resolve the token from the IDB-backed vault. The fetch stub
 * here only handles the GET /user round-trip in connectGitHubSession;
 * the test re-stubs after for the actual flow being exercised.
 */
async function connectSession(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    queuedFetch([
      { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, pull_request' } },
    ]),
  );
  await useWorkspaceStore.getState().connectGitHubSession('tok');
  vi.unstubAllGlobals();
}

describe('workspace meta.updatedAt bump invariant', () => {
  // Without a centralized bump, plan-action reducers (which only stamp
  // per-plan `plan.updatedAt`) left the workspace-level
  // `synced.meta.updatedAt` stale — so a collaborator pulling sees the
  // plan changes but the workspace's "Last updated" was wrong. The
  // commitSynced wrapper now bumps it on every commit. These tests
  // pin that contract so future reducer additions can't regress it.

  function metaOf(): string {
    return useWorkspaceStore.getState().synced!.meta.updatedAt;
  }

  async function expectsMetaBump(label: string, mutate: () => void): Promise<void> {
    const before = metaOf();
    // Force a 1ms gap so the new ISO timestamp differs from the previous
    // commit, even when wall-clock resolution is coarse.
    await new Promise((r) => setTimeout(r, 2));
    mutate();
    const after = metaOf();
    expect(after, `[${label}] meta.updatedAt should advance`).not.toBe(before);
    expect(new Date(after).getTime(), `[${label}] forward in time`).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
  }

  it('every plan mutation bumps workspace meta.updatedAt', async () => {
    const r = useWorkspaceStore.getState().addRequest(null, 'r');
    // addPlan
    let planId = '';
    await expectsMetaBump('addPlan', () => {
      planId = useWorkspaceStore.getState().addPlan('p');
    });
    // renamePlan
    await expectsMetaBump('renamePlan', () =>
      useWorkspaceStore.getState().renamePlan(planId, 'Renamed'),
    );
    // addPlanStep
    await expectsMetaBump('addPlanStep', () => useWorkspaceStore.getState().addPlanStep(planId, r));
    await expectsMetaBump('addPlanStep #2', () =>
      useWorkspaceStore.getState().addPlanStep(planId, r),
    );
    // reorderPlanSteps
    await expectsMetaBump('reorderPlanSteps', () =>
      useWorkspaceStore.getState().reorderPlanSteps(planId, 0, 1),
    );
    // setPlanStepEnabled
    await expectsMetaBump('setPlanStepEnabled', () =>
      useWorkspaceStore.getState().setPlanStepEnabled(planId, 0, false),
    );
    // setPlanEnvPriority
    await expectsMetaBump('setPlanEnvPriority', () =>
      useWorkspaceStore.getState().setPlanEnvPriority(planId, [{ kind: 'local', name: 'dev' }]),
    );
    // setPlanStopOnFailure
    await expectsMetaBump('setPlanStopOnFailure', () =>
      useWorkspaceStore.getState().setPlanStopOnFailure(planId, true),
    );
    // setPlanVariables
    await expectsMetaBump('setPlanVariables', () =>
      useWorkspaceStore.getState().setPlanVariables(planId, [{ key: 'X', value: '1' }]),
    );
    // removePlanStep
    await expectsMetaBump('removePlanStep', () =>
      useWorkspaceStore.getState().removePlanStep(planId, 0),
    );
    // duplicatePlan
    await expectsMetaBump('duplicatePlan', () => {
      useWorkspaceStore.getState().duplicatePlan(planId);
    });
    // removePlan
    await expectsMetaBump('removePlan', () => useWorkspaceStore.getState().removePlan(planId));
  });

  it('renaming a vault secret slot updates synced.secretKeys[id].label so the rename travels through Git', async () => {
    // Pre-fix, renameSecret only wrote to `local.secretIndex` — the
    // Git-synced `synced.secretKeys` registry kept the old label, so a
    // teammate pulling saw the stale name. Now the rename mirrors
    // into synced so both sides agree.
    const id = await useWorkspaceStore.getState().addSecret({ label: 'OLD_LABEL', value: 'v' });
    expect(useWorkspaceStore.getState().synced!.secretKeys?.[id].label).toBe('OLD_LABEL');
    useWorkspaceStore.getState().renameSecret(id, 'NEW_LABEL');
    // Both sides updated.
    expect(useWorkspaceStore.getState().local!.secretIndex.entries[id].label).toBe('NEW_LABEL');
    expect(useWorkspaceStore.getState().synced!.secretKeys?.[id].label).toBe('NEW_LABEL');
  });

  it('renaming a linked-origin secret slot does NOT touch synced.secretKeys (those are owned by the source)', async () => {
    // Linked-origin slots don't have a `synced.secretKeys[id]` entry
    // on the consumer (the source workspace owns that metadata). The
    // rename should be a local-only label override; never mutate
    // synced.secretKeys.
    const id = await useWorkspaceStore.getState().addSecret({
      label: 'link:Payments:DB_TOKEN',
      value: 'v',
      origin: 'linked',
      linkedWorkspaceId: 'lw-1',
      linkedKeyId: 'DB_TOKEN',
    });
    expect(useWorkspaceStore.getState().synced!.secretKeys?.[id]).toBeUndefined();
    useWorkspaceStore.getState().renameSecret(id, 'custom local label');
    expect(useWorkspaceStore.getState().local!.secretIndex.entries[id].label).toBe(
      'custom local label',
    );
    // Still no synced.secretKeys entry — linked slot metadata stays in
    // the source's workspace.json.
    expect(useWorkspaceStore.getState().synced!.secretKeys?.[id]).toBeUndefined();
  });

  it('editor + environment + mock mutations also bump meta.updatedAt (regression guard)', async () => {
    // Editor
    let reqId = '';
    await expectsMetaBump('addRequest', () => {
      reqId = useWorkspaceStore.getState().addRequest(null, 'r');
    });
    await expectsMetaBump('setRequestUrl', () =>
      useWorkspaceStore.getState().setRequestUrl(reqId, 'https://x'),
    );
    await expectsMetaBump('renameRequest', () =>
      useWorkspaceStore.getState().renameRequest(reqId, 'r2'),
    );
    // Environment
    await expectsMetaBump('addEnvironment', () =>
      useWorkspaceStore.getState().addEnvironment('dev'),
    );
    await expectsMetaBump('setVariables', () =>
      useWorkspaceStore
        .getState()
        .setVariables('dev', [{ key: 'BASE_URL', value: 'https://dev', encrypted: false }]),
    );
    // Mock server
    await expectsMetaBump('createMockServer', () => {
      useWorkspaceStore
        .getState()
        .createMockServer({ name: 'm1', source: { kind: 'manual', endpoints: [] } });
    });
  });
});

describe('clone scenario — Second workspace pulling First workspace.json', () => {
  it('execution plans round-trip through Git and appear on the cloned workspace', () => {
    // First workspace builds a plan + step, then we serialize for Git.
    const r1 = useWorkspaceStore.getState().addRequest(null, 'list users');
    useWorkspaceStore.getState().setRequestUrl(r1, 'https://api.test/users');
    const planId = useWorkspaceStore.getState().addPlan('Smoke');
    useWorkspaceStore.getState().addPlanStep(planId, r1);

    // The synced doc — what `serializeWorkspaceForGit` would push.
    const firstSynced = useWorkspaceStore.getState().synced!;
    const serialized = serializeWorkspaceForGit(firstSynced);
    const parsed = JSON.parse(serialized) as WorkspaceSynced;

    // Plan AND its steps survive the JSON round-trip.
    expect(parsed.executionPlans).toBeDefined();
    expect(parsed.executionPlans?.[planId]).toBeDefined();
    expect(parsed.executionPlans?.[planId].name).toBe('Smoke');
    expect(parsed.executionPlans?.[planId].steps).toEqual([{ requestId: r1 }]);
  });

  it('mock servers round-trip through Git', () => {
    // Seed a mock server using the manual-source path.
    const synced = useWorkspaceStore.getState().synced!;
    const mockId = 'mock-1';
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        mockServers: {
          [mockId]: {
            id: mockId,
            name: 'Stripe stub',
            source: { kind: 'manual', endpoints: [] },
            endpoints: [
              {
                id: 'ep-1',
                name: 'GET /health',
                method: 'GET',
                pathPattern: '/health',
                requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
                requestValidation: [],
                responseRules: [],
                defaultResponse: {
                  status: 200,
                  headers: [],
                  body: { type: 'json' as const, content: '{"ok":true}' },
                  delayMs: 0,
                },
              },
            ],
            defaultPort: null,
            cors: { enabled: true, origins: ['*'] },
            createdAt: 't',
            updatedAt: 't',
          },
        },
      },
    });
    const serialized = serializeWorkspaceForGit(useWorkspaceStore.getState().synced!);
    const parsed = JSON.parse(serialized) as WorkspaceSynced;
    expect(parsed.mockServers[mockId]).toBeDefined();
    expect(parsed.mockServers[mockId].name).toBe('Stripe stub');
    expect(parsed.mockServers[mockId].endpoints).toHaveLength(1);
  });

  it('linkedWorkspaces metadata round-trips; linkedCollections (local cache) does NOT', () => {
    const synced = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: {
          'lw-1': {
            id: 'lw-1',
            kind: 'private',
            name: 'Payments',
            source: {
              provider: 'github',
              repoFullName: 'org/payments',
              branch: 'main',
              sessionMode: 'workspace',
            },
            scope: ['collections', 'environments'],
            pinnedVersion: '1.0.0',
            updatePolicy: 'manual',
            linkedAt: 't',
            requiredSecretKeyIds: [],
          },
        },
      },
    });
    const serialized = serializeWorkspaceForGit(useWorkspaceStore.getState().synced!);
    const parsed = JSON.parse(serialized) as WorkspaceSynced;
    expect(parsed.linkedWorkspaces['lw-1']).toBeDefined();
    expect(parsed.linkedWorkspaces['lw-1'].source.repoFullName).toBe('org/payments');
    // The linkedCollections snapshot intentionally stays in
    // WorkspaceLocal — too large to push, and rebuilt on Refresh.
    expect(
      (parsed as unknown as { linkedCollections?: unknown }).linkedCollections,
    ).toBeUndefined();
  });

  it('refreshWorkspace auto-bootstraps linked snapshots that have metadata but no local cache', async () => {
    // Set up a workspace where (a) we have a working branch, (b) the
    // remote workspace.json declares a linked workspace, but (c) we
    // have no local snapshot yet — fresh-clone state.
    await connectSession();
    const local = useWorkspaceStore.getState().local!;
    const synced = useWorkspaceStore.getState().synced!;
    const linkId = 'lw-payments';

    // Seed: a working branch + a connected repo. The session is real
    // (set up by connectSession above) so the bootstrap step's
    // decryptSessionToken can resolve a token.
    useWorkspaceStore.setState({
      local: {
        ...local,
        connectedRepo: {
          owner: 'me',
          name: 'first',
          fullName: 'me/first',
          defaultBranch: 'main',
          visibility: 'public',
          isPrivate: false,
          pushable: true,
          connectedAt: 't',
        },
        workingBranch: {
          name: 'work',
          baseBranch: 'main',
          repoFullName: 'me/first',
          repoOwner: 'me',
          repoName: 'first',
          headSha: 'abc',
          createdAt: 't',
          lastPushedSha: 'abc',
          diffSummary: null,
          openPrUrl: null,
        },
        // Seed lastPulledSnapshot to the current synced doc so the
        // 3-way diff has a valid base (= synced; remote is the only
        // thing that's "new"). Without this, computeThreeWayDiff
        // throws on null.
        sync: {
          ...local.sync,
          lastPulledSnapshot: synced,
          lastPulledSha: 'abc',
        },
      },
    });

    // The remote workspace.json (working branch) carries a link
    // declaration but has no companion linkedCollections — that's
    // what the second workspace is about to clone.
    const remoteFirst: WorkspaceSynced = {
      ...synced,
      linkedWorkspaces: {
        [linkId]: {
          id: linkId,
          kind: 'private',
          name: 'Payments',
          source: {
            provider: 'github',
            repoFullName: 'org/payments',
            branch: 'main',
            sessionMode: 'workspace',
          },
          scope: ['collections', 'environments'],
          pinnedVersion: null,
          updatePolicy: 'manual',
          linkedAt: 't',
          requiredSecretKeyIds: [],
        },
      },
    };

    // The linked source's workspace.json (what the auto-bootstrap
    // refresh will fetch).
    const sourceJson = JSON.stringify({
      workspaceName: 'Payments',
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'pay-1' }] },
        requests: {
          'pay-1': {
            id: 'pay-1',
            name: 'Charge',
            folderId: null,
            method: 'POST',
            url: 'https://payments.test/charge',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: 't',
            updatedAt: 't',
          },
        },
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      releases: { self: { versions: [], currentVersion: null } },
    });

    // Three fetches happen during refreshWorkspace:
    //   1. probeBranchRetirement → getBranchHead on working branch (alive).
    //   2. GET workspace.json on the working branch (returns remoteFirst).
    //   3. After persistMerged, the bootstrap step fetches the LINKED
    //      source's workspace.json once (returns sourceJson).
    // (The PR-state probe is skipped when openPrUrl is null on the
    // working branch.)
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        { body: { name: 'work', commit: { sha: 'abc' } } },
        fileContents(JSON.stringify(remoteFirst)),
        fileContents(sourceJson),
      ]),
    );

    await useWorkspaceStore.getState().refreshWorkspace();

    // Linked metadata landed in synced.
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces[linkId]).toBeDefined();

    // Critical: linkedCollections was bootstrapped — without this the
    // second workspace would see "Refresh ledger" do nothing.
    const cached = useWorkspaceStore.getState().local!.linkedCollections[linkId];
    expect(cached).toBeDefined();
    expect(cached.workspaceName).toBe('Payments');
    expect(cached.collections.requests['pay-1']).toBeDefined();
    expect(cached.collections.requests['pay-1'].url).toBe('https://payments.test/charge');
  });

  it('refreshLinkedWorkspace bootstraps a missing snapshot on first call', async () => {
    // Same shape as above but exercising the link-card "Refresh ledger"
    // button directly — pre-fix this only updated the ledger, not the
    // snapshot, which left the user stuck.
    await connectSession();
    const synced = useWorkspaceStore.getState().synced!;
    const linkId = 'lw-direct';

    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: {
          [linkId]: {
            id: linkId,
            kind: 'private',
            name: 'API',
            source: {
              provider: 'github',
              repoFullName: 'org/api',
              branch: 'main',
              sessionMode: 'workspace',
            },
            scope: ['collections', 'environments'],
            pinnedVersion: null,
            updatePolicy: 'manual',
            linkedAt: 't',
            requiredSecretKeyIds: [],
          },
        },
      },
    });

    const sourceJson = JSON.stringify({
      workspaceName: 'API',
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r-1' }] },
        requests: {
          'r-1': {
            id: 'r-1',
            name: 'List',
            folderId: null,
            method: 'GET',
            url: 'https://api.test/items',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: 't',
            updatedAt: 't',
          },
        },
        folders: {},
      },
      environments: {
        items: {
          dev: {
            name: 'dev',
            variables: [{ key: 'BASE_URL', value: 'https://dev', encrypted: false }],
          },
        },
        activeName: 'dev',
        priorityOrder: [{ kind: 'local', name: 'dev' }],
      },
      releases: {
        self: {
          versions: [
            {
              version: '1.0.0',
              publishedAt: 't',
              notes: '',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '1.0.0',
        },
      },
    });
    vi.stubGlobal('fetch', queuedFetch([fileContents(sourceJson)]));

    // No snapshot before.
    expect(useWorkspaceStore.getState().local!.linkedCollections[linkId]).toBeUndefined();

    await useWorkspaceStore.getState().refreshLinkedWorkspace(linkId);

    // Ledger AND snapshot populated.
    const ledger = useWorkspaceStore.getState().synced!.releases.perLink[linkId];
    expect(ledger.currentVersion).toBe('1.0.0');
    const snap = useWorkspaceStore.getState().local!.linkedCollections[linkId];
    expect(snap).toBeDefined();
    expect(snap.collections.requests['r-1']).toBeDefined();
    expect(snap.environments.items.dev).toBeDefined();
  });

  it('refreshLinkedWorkspace does NOT clobber an existing snapshot — steady-state stays ledger-only', async () => {
    // When the snapshot exists, refresh stays ledger-only (preserving
    // the "Refresh = ledger only; Apply = atomic" invariant). Without
    // this, a refresh would overwrite the cached snapshot with the
    // upstream HEAD's bytes, killing the diff against pinned content.
    await connectSession();
    const local = useWorkspaceStore.getState().local!;
    const synced = useWorkspaceStore.getState().synced!;
    const linkId = 'lw-stable';

    const existingSnapshot = {
      workspaceName: 'API (frozen at v0.9)',
      pulledAt: 't',
      ref: 'v0.9.0',
      collections: {
        tree: { id: 'r', type: 'root' as const, children: [] },
        requests: {},
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
    };

    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: {
          [linkId]: {
            id: linkId,
            kind: 'private',
            name: 'API',
            source: {
              provider: 'github',
              repoFullName: 'org/api',
              branch: 'main',
              sessionMode: 'workspace',
            },
            scope: ['collections', 'environments'],
            pinnedVersion: '0.9.0',
            updatePolicy: 'manual',
            linkedAt: 't',
            requiredSecretKeyIds: [],
          },
        },
      },
      local: {
        ...local,
        linkedCollections: { [linkId]: existingSnapshot },
      },
    });

    // Source workspace.json reports a NEW version 1.0.0 — refresh
    // should bring in the new ledger entry but NOT touch the snapshot.
    const sourceJson = JSON.stringify({
      workspaceName: 'API',
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'new-r' }] },
        requests: {
          'new-r': {
            id: 'new-r',
            name: 'Newer endpoint',
            folderId: null,
            method: 'GET',
            url: 'https://api.test/v2',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: 't',
            updatedAt: 't',
          },
        },
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      releases: {
        self: {
          versions: [
            {
              version: '0.9.0',
              publishedAt: 't',
              notes: '',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
            {
              version: '1.0.0',
              publishedAt: 't',
              notes: 'major',
              workspaceSnapshot: 'b'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '1.0.0',
        },
      },
    });
    vi.stubGlobal('fetch', queuedFetch([fileContents(sourceJson)]));

    await useWorkspaceStore.getState().refreshLinkedWorkspace(linkId);

    // Ledger updated to include 1.0.0.
    const ledger = useWorkspaceStore.getState().synced!.releases.perLink[linkId];
    expect(ledger.currentVersion).toBe('1.0.0');
    expect(ledger.versions).toHaveLength(2);

    // Snapshot UNCHANGED — still the v0.9 frozen state.
    const snap = useWorkspaceStore.getState().local!.linkedCollections[linkId];
    expect(snap.workspaceName).toBe('API (frozen at v0.9)');
    expect(snap.collections.requests['new-r']).toBeUndefined();
  });
});
