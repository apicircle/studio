// Workspace restore (TC-WR-*) — clone-replay-restore round trips.
//
// Each round-trip test seeds an entity in the live store, pushes the
// workspace through the real GitHubClient wire path to the mock repo,
// then runs `refreshWorkspace()` to pull `workspace.json` back. The
// assertion runs against `local.sync.lastPulledSnapshot` — the doc as
// re-parsed FROM Git, not the in-memory copy — so it genuinely proves
// the entity survives serialize → push → fetch → parse intact.
//
// The mock GitHub data plane lives in apps/e2e-mock /_gh/* (control
// plane at /__gh); see apps/web/e2e/fixtures/gitFixture.ts.

import { test, expect } from './fixtures/gitFixture';
import type { Page } from '@playwright/test';
import type { WorkspaceSynced } from '@apicircle/shared';
import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
import { tcMapWR } from './fixtures/tcMapWR';

function wr(key: string): TcId {
  const v = tcMapWR[key];
  if (!v) throw new Error(`No TC-WR entry for "${key}"`);
  return v;
}

const OWNER = 'mock-user';
const ISO = '2026-05-17T00:00:00.000Z';

function repoName(slug: string): string {
  return `wr-${slug}-${test.info().workerIndex}`;
}

// Store actions + state the in-browser `evaluate` blocks reach for. The
// `__apicircleStore` window bridge (workspaceStore.ts) exposes the full
// Zustand store; the bridge comment there explicitly sanctions e2e specs
// reading AND seeding it. Referenced as a type inside `evaluate` — type
// annotations are erased before the function is serialised to the page.
interface StoreApi {
  connectGitHubSession: (token: string) => Promise<unknown>;
  connectRepo: (owner: string, name: string) => Promise<unknown>;
  createWorkingBranch: () => Promise<unknown>;
  pushWorkspace: (message?: string) => Promise<{ commitSha: string }>;
  refreshWorkspace: () => Promise<{ status: string }>;
  addRequest: (parentFolderId: string | null, name?: string) => string;
  addFolder: (parentFolderId: string | null, name?: string) => string;
  setRequestMethod: (id: string, method: string) => void;
  setRequestUrl: (id: string, url: string) => void;
  setRequestHeaders: (
    id: string,
    headers: Array<{ key: string; value: string; enabled: boolean }>,
  ) => void;
  setRequestBody: (id: string, body: { type: string; content: string }) => void;
  setRequestAuth: (id: string, auth: { type: string; key: string; value: string }) => void;
  setRequestBodySchemaId: (id: string, schemaId: string | null) => void;
  addEnvironment: (name: string) => void;
  setVariables: (
    envName: string,
    variables: Array<{ key: string; value: string; encrypted: boolean }>,
  ) => void;
  setActiveEnvironment: (name: string | null) => void;
  addPlan: (name?: string) => string;
  addPlanStep: (planId: string, requestId: string) => void;
  setPlanStepEnabled: (planId: string, stepIndex: number, enabled: boolean) => void;
  createMockServer: (args: {
    name: string;
    source: { kind: 'manual'; endpoints: unknown[] };
  }) => string;
  addGlobalSchema: (init: { name: string; schema?: string }) => string;
  addGlobalGraphQL: (init: { name: string; source?: string }) => string;
}

interface StoreState extends StoreApi {
  synced: WorkspaceSynced;
  local: { sync: { lastPulledSnapshot: WorkspaceSynced | null } };
}

interface StoreBridge {
  getState: () => StoreState;
  setState: (partial: { synced: WorkspaceSynced }) => void;
}

/**
 * Connect → create a working branch → push → pull. Returns the workspace
 * doc as re-parsed FROM the mock Git remote (`lastPulledSnapshot` after a
 * clean refresh), so callers assert against the round-tripped copy rather
 * than the local in-memory one.
 */
async function pushAndRestore(app: Page, name: string): Promise<WorkspaceSynced> {
  return app.evaluate(
    async (repo) => {
      const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
      const s = b.getState();
      await s.connectGitHubSession('ghp_mock_test_token');
      await s.connectRepo(repo.owner, repo.name);
      await s.createWorkingBranch();
      await s.pushWorkspace('round-trip seed');
      const refresh = await s.refreshWorkspace();
      if (refresh.status !== 'up-to-date') {
        // A non-clean status means the doc did NOT round-trip losslessly —
        // surface it instead of silently asserting on a merged result.
        throw new Error(`round-trip refresh expected "up-to-date", got "${refresh.status}"`);
      }
      const snapshot = b.getState().local.sync.lastPulledSnapshot;
      if (!snapshot) throw new Error('lastPulledSnapshot is null after a clean refresh');
      return snapshot;
    },
    { owner: OWNER, name },
  );
}

test.describe('Workspace restore — entity round-trips', () => {
  test(
    tc(wr('Round-trip: Collections and folders (tree)'), 'collection tree round-trips through Git'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0001');
      await mockGithub.seedRepo({ owner: OWNER, name });
      const ids = await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const s = b.getState();
        const folderA = s.addFolder(null, 'Folder A');
        const sub = s.addFolder(folderA, 'Nested folder');
        const inA = s.addRequest(folderA, 'Request in A');
        const inSub = s.addRequest(sub, 'Request in nested');
        const atRoot = s.addRequest(null, 'Root request');
        return { folderA, sub, inA, inSub, atRoot };
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(remote.collections.folders[ids.folderA].name).toBe('Folder A');
      expect(remote.collections.folders[ids.sub].name).toBe('Nested folder');
      expect(remote.collections.folders[ids.sub].parentId).toBe(ids.folderA);
      expect(remote.collections.requests[ids.inA].folderId).toBe(ids.folderA);
      expect(remote.collections.requests[ids.inSub].folderId).toBe(ids.sub);
      expect(remote.collections.requests[ids.atRoot].folderId).toBeNull();
    },
  );

  test(
    tc(
      wr('Round-trip: Request URL/method/headers/body/auth'),
      'request method/url/headers/body/auth round-trip through Git',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0002');
      await mockGithub.seedRepo({ owner: OWNER, name });
      const reqId = await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const s = b.getState();
        const id = s.addRequest(null, 'Create order');
        s.setRequestMethod(id, 'POST');
        s.setRequestUrl(id, 'https://api.example.com/orders');
        s.setRequestHeaders(id, [{ key: 'X-Custom', value: 'hello', enabled: true }]);
        s.setRequestBody(id, { type: 'json', content: '{"hello":"world"}' });
        // custom-header auth is NOT redacted on push (see redactWorkspace.ts),
        // so it survives the round-trip verbatim — credential-bearing auth
        // types are deliberately exercised in auth-wire.spec.ts instead.
        s.setRequestAuth(id, { type: 'custom-header', key: 'X-Trace', value: 'trace-abc' });
        return id;
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      const req = remote.collections.requests[reqId];
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://api.example.com/orders');
      expect(req.headers).toEqual([{ key: 'X-Custom', value: 'hello', enabled: true }]);
      expect(req.body.type).toBe('json');
      expect(req.body.content).toBe('{"hello":"world"}');
      expect(req.auth.type).toBe('custom-header');
      if (req.auth.type === 'custom-header') {
        expect(req.auth.key).toBe('X-Trace');
        expect(req.auth.value).toBe('trace-abc');
      }
    },
  );

  test(
    tc(wr('Round-trip: Body schema reference'), 'request body-schema reference round-trips'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0006');
      await mockGithub.seedRepo({ owner: OWNER, name });
      const ids = await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const s = b.getState();
        const schemaId = s.addGlobalSchema({
          name: 'Order',
          schema: '{"type":"object","required":["id"]}',
        });
        const reqId = s.addRequest(null, 'Place order');
        s.setRequestBodySchemaId(reqId, schemaId);
        return { schemaId, reqId };
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(remote.globalAssets.schemas[ids.schemaId].name).toBe('Order');
      expect(remote.collections.requests[ids.reqId].bodySchemaId).toBe(ids.schemaId);
    },
  );

  test(
    tc(
      wr('Round-trip: Environments and their variables'),
      'environment + variables round-trip through Git',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0007');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const s = b.getState();
        s.addEnvironment('staging');
        s.setVariables('staging', [
          { key: 'BASE_URL', value: 'https://staging.example.com', encrypted: false },
          { key: 'TIMEOUT', value: '30', encrypted: false },
        ]);
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      const env = remote.environments.items['staging'];
      expect(env.name).toBe('staging');
      expect(env.variables).toEqual([
        { key: 'BASE_URL', value: 'https://staging.example.com', encrypted: false },
        { key: 'TIMEOUT', value: '30', encrypted: false },
      ]);
    },
  );

  test(
    tc(wr('Round-trip: Environment priority order'), 'environment priority order round-trips'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0008');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const s = b.getState();
        s.addEnvironment('alpha');
        s.addEnvironment('beta');
        s.addEnvironment('gamma');
        // Reorder away from creation order so the assertion proves ORDER
        // is preserved, not merely membership.
        const synced = b.getState().synced;
        b.setState({
          synced: {
            ...synced,
            environments: {
              ...synced.environments,
              priorityOrder: [
                { kind: 'local', name: 'gamma' },
                { kind: 'local', name: 'alpha' },
                { kind: 'local', name: 'beta' },
              ],
            },
          },
        });
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(remote.environments.priorityOrder).toEqual([
        { kind: 'local', name: 'gamma' },
        { kind: 'local', name: 'alpha' },
        { kind: 'local', name: 'beta' },
      ]);
    },
  );

  test(
    tc(wr('Round-trip: Active environment'), 'active environment selection round-trips'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0009');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const s = b.getState();
        s.addEnvironment('production');
        s.setActiveEnvironment('production');
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(remote.environments.activeName).toBe('production');
      expect(remote.environments.items['production'].name).toBe('production');
    },
  );

  test(
    tc(
      wr('Round-trip: Secret variables (encrypted at rest)'),
      'encrypted secret variable round-trips as ciphertext, never plaintext',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0010');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate((iso) => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const synced = b.getState().synced;
        b.setState({
          synced: {
            ...synced,
            environments: {
              ...synced.environments,
              items: {
                ...synced.environments.items,
                secure: {
                  name: 'secure',
                  variables: [
                    {
                      key: 'API_TOKEN',
                      // `enc:v1:` ciphertext — exactly what travels through
                      // Git. The slot's plaintext value lives only in the
                      // device-local vault and is never serialised.
                      value: 'enc:v1:aXY=:Y2lwaGVydGV4dA==',
                      encrypted: true,
                      secretKeyId: 'sk-token',
                    },
                  ],
                },
              },
              priorityOrder: [
                ...synced.environments.priorityOrder,
                { kind: 'local', name: 'secure' },
              ],
            },
            secretKeys: {
              ...(synced.secretKeys ?? {}),
              'sk-token': {
                id: 'sk-token',
                label: 'API Token',
                salt: 'c2FsdHZhbHVl',
                createdAt: iso,
              },
            },
          },
        });
      }, ISO);
      const remote = await pushAndRestore(appWithGithubMock, name);
      const variable = remote.environments.items['secure'].variables[0];
      expect(variable.encrypted).toBe(true);
      expect(variable.secretKeyId).toBe('sk-token');
      expect(variable.value).toBe('enc:v1:aXY=:Y2lwaGVydGV4dA==');
      expect(remote.secretKeys?.['sk-token'].label).toBe('API Token');
    },
  );

  test(
    tc(wr('Round-trip: Execution plans'), 'execution plan + step round-trip through Git'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0011');
      await mockGithub.seedRepo({ owner: OWNER, name });
      const ids = await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const s = b.getState();
        const reqId = s.addRequest(null, 'List users');
        const planId = s.addPlan('Smoke suite');
        s.addPlanStep(planId, reqId);
        return { reqId, planId };
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      const plan = remote.executionPlans?.[ids.planId];
      expect(plan?.name).toBe('Smoke suite');
      expect(plan?.steps[0].requestId).toBe(ids.reqId);
    },
  );

  test(
    tc(wr('Round-trip: Plan step enable/disable flags'), 'plan step enabled flag round-trips'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0012');
      await mockGithub.seedRepo({ owner: OWNER, name });
      const planId = await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const s = b.getState();
        const r1 = s.addRequest(null, 'Step one');
        const r2 = s.addRequest(null, 'Step two');
        const plan = s.addPlan('Two-step plan');
        s.addPlanStep(plan, r1);
        s.addPlanStep(plan, r2);
        s.setPlanStepEnabled(plan, 1, false);
        return plan;
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      const steps = remote.executionPlans?.[planId].steps;
      expect(steps).toHaveLength(2);
      expect(steps?.[1].enabled).toBe(false);
    },
  );

  test(
    tc(wr('Round-trip: Mock servers'), 'mock server definition round-trips through Git'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0013');
      await mockGithub.seedRepo({ owner: OWNER, name });
      const mockId = await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        return b.getState().createMockServer({
          name: 'Billing mock',
          source: { kind: 'manual', endpoints: [] },
        });
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(remote.mockServers[mockId].name).toBe('Billing mock');
      expect(remote.mockServers[mockId].source.kind).toBe('manual');
    },
  );

  test(
    tc(
      wr('Round-trip: Mock endpoint matching rules'),
      'mock endpoint path pattern + validation rules round-trip',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0014');
      await mockGithub.seedRepo({ owner: OWNER, name });
      const mockId = await appWithGithubMock.evaluate((iso) => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const synced = b.getState().synced;
        const endpoint = {
          id: 'ep-pet',
          name: 'GET /pets/{id}',
          method: 'GET' as const,
          pathPattern: '/pets/{id}',
          requestSchema: {
            pathParams: [{ id: 'p-id', name: 'id', required: true }],
            queryParams: [],
            headers: [],
            cookies: [],
          },
          requestValidation: [
            {
              id: 'rule-1',
              kind: 'header-required' as const,
              target: 'X-Api-Key',
              message: 'API key is required',
              enabled: true,
              failResponse: {
                status: 401,
                headers: [],
                body: { type: 'json' as const, content: '{"error":"unauthorized"}' },
              },
            },
          ],
          responseRules: [],
          defaultResponse: {
            status: 200,
            headers: [],
            body: { type: 'json' as const, content: '{"id":"1"}' },
            delayMs: 0,
          },
        };
        b.setState({
          synced: {
            ...synced,
            mockServers: {
              ...synced.mockServers,
              'mock-pets': {
                id: 'mock-pets',
                name: 'Pets mock',
                source: { kind: 'manual', endpoints: [endpoint] },
                endpoints: [endpoint],
                defaultPort: null,
                cors: { enabled: false, origins: [] },
                createdAt: iso,
                updatedAt: iso,
              },
            },
          },
        });
        return 'mock-pets';
      }, ISO);
      const remote = await pushAndRestore(appWithGithubMock, name);
      const endpoint = remote.mockServers[mockId].endpoints[0];
      expect(endpoint.pathPattern).toBe('/pets/{id}');
      expect(endpoint.requestSchema.pathParams[0].name).toBe('id');
      expect(endpoint.requestValidation[0].kind).toBe('header-required');
      expect(endpoint.requestValidation[0].target).toBe('X-Api-Key');
    },
  );

  test(
    tc(
      wr('Round-trip: Mock response bodies and headers'),
      'mock endpoint default response body + headers round-trip',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0015');
      await mockGithub.seedRepo({ owner: OWNER, name });
      const mockId = await appWithGithubMock.evaluate((iso) => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const synced = b.getState().synced;
        const endpoint = {
          id: 'ep-health',
          name: 'GET /health',
          method: 'GET' as const,
          pathPattern: '/health',
          requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
          requestValidation: [],
          responseRules: [],
          defaultResponse: {
            status: 503,
            headers: [{ key: 'Retry-After', value: '120', enabled: true }],
            body: { type: 'json' as const, content: '{"status":"degraded"}' },
            delayMs: 250,
          },
        };
        b.setState({
          synced: {
            ...synced,
            mockServers: {
              ...synced.mockServers,
              'mock-health': {
                id: 'mock-health',
                name: 'Health mock',
                source: { kind: 'manual', endpoints: [endpoint] },
                endpoints: [endpoint],
                defaultPort: null,
                cors: { enabled: true, origins: ['*'] },
                createdAt: iso,
                updatedAt: iso,
              },
            },
          },
        });
        return 'mock-health';
      }, ISO);
      const remote = await pushAndRestore(appWithGithubMock, name);
      const response = remote.mockServers[mockId].endpoints[0].defaultResponse;
      expect(response.status).toBe(503);
      expect(response.headers).toEqual([{ key: 'Retry-After', value: '120', enabled: true }]);
      expect(response.body.content).toBe('{"status":"degraded"}');
      expect(response.delayMs).toBe(250);
    },
  );

  test(
    tc(
      wr('Round-trip: Linked workspaces and overrides'),
      'linked workspace + env-var override round-trip through Git',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0016');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate((iso) => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const synced = b.getState().synced;
        b.setState({
          synced: {
            ...synced,
            linkedWorkspaces: {
              'lw-payments': {
                id: 'lw-payments',
                kind: 'private',
                name: 'Payments API',
                description: 'Shared billing endpoints',
                source: {
                  provider: 'github',
                  repoFullName: 'acme/payments',
                  branch: 'main',
                  sessionMode: 'workspace',
                },
                scope: ['collections', 'environments'],
                pinnedVersion: '1.4.0',
                updatePolicy: 'manual',
                linkedAt: iso,
                requiredSecretKeyIds: [],
              },
            },
            linkedOverrides: {
              ...synced.linkedOverrides,
              environmentVars: {
                'lw-payments:prod:BASE_URL': {
                  linkedWorkspaceId: 'lw-payments',
                  envName: 'prod',
                  varKey: 'BASE_URL',
                  value: 'https://payments.acme.test',
                  updatedAt: iso,
                },
              },
            },
          },
        });
      }, ISO);
      const remote = await pushAndRestore(appWithGithubMock, name);
      const linked = remote.linkedWorkspaces['lw-payments'];
      expect(linked.name).toBe('Payments API');
      expect(linked.source.repoFullName).toBe('acme/payments');
      expect(linked.pinnedVersion).toBe('1.4.0');
      expect(remote.linkedOverrides.environmentVars['lw-payments:prod:BASE_URL'].value).toBe(
        'https://payments.acme.test',
      );
    },
  );

  test(
    tc(wr('Round-trip: Linked request overrides'), 'linked request override patch round-trips'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0017');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate((iso) => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const synced = b.getState().synced;
        b.setState({
          synced: {
            ...synced,
            linkedOverrides: {
              ...synced.linkedOverrides,
              requests: {
                'lw-payments:req-charge': {
                  linkedWorkspaceId: 'lw-payments',
                  itemId: 'req-charge',
                  patch: { url: 'https://override.acme.test/charge', method: 'PUT' },
                  updatedAt: iso,
                },
              },
            },
          },
        });
      }, ISO);
      const remote = await pushAndRestore(appWithGithubMock, name);
      const override = remote.linkedOverrides.requests['lw-payments:req-charge'];
      expect(override.itemId).toBe('req-charge');
      expect(override.patch.url).toBe('https://override.acme.test/charge');
      expect(override.patch.method).toBe('PUT');
    },
  );

  test(
    tc(wr('Round-trip: Global JSON Schemas'), 'global JSON schema round-trips through Git'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0018');
      await mockGithub.seedRepo({ owner: OWNER, name });
      const schemaId = await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        return b.getState().addGlobalSchema({
          name: 'User',
          schema: '{"type":"object","properties":{"email":{"type":"string"}}}',
        });
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      const schema = remote.globalAssets.schemas[schemaId];
      expect(schema.name).toBe('User');
      expect(schema.schema).toContain('"email"');
    },
  );

  test(
    tc(wr('Round-trip: Global GraphQL docs'), 'global GraphQL schema round-trips through Git'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0019');
      await mockGithub.seedRepo({ owner: OWNER, name });
      const graphqlId = await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        return b.getState().addGlobalGraphQL({
          name: 'Catalog',
          source: 'type Query {\n  products: [String!]!\n}',
        });
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      const graphql = remote.globalAssets.graphql[graphqlId];
      expect(graphql.name).toBe('Catalog');
      expect(graphql.source).toContain('products');
    },
  );

  test(
    tc(
      wr('Round-trip: Release ledger entries'),
      'workspace release ledger round-trips through Git',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0020');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate((iso) => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const synced = b.getState().synced;
        b.setState({
          synced: {
            ...synced,
            releases: {
              ...synced.releases,
              self: {
                versions: [
                  {
                    version: '1.0.0',
                    publishedAt: iso,
                    notes: 'First public cut',
                    workspaceSnapshot: 'a'.repeat(64),
                    deprecated: false,
                    yanked: false,
                  },
                ],
                currentVersion: '1.0.0',
              },
            },
          },
        });
      }, ISO);
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(remote.releases.self?.currentVersion).toBe('1.0.0');
      expect(remote.releases.self?.versions[0].notes).toBe('First public cut');
    },
  );

  test(
    tc(wr('Round-trip: Linked release ledger'), 'cached linked release ledger round-trips'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0021');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate((iso) => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const synced = b.getState().synced;
        b.setState({
          synced: {
            ...synced,
            releases: {
              ...synced.releases,
              perLink: {
                'lw-payments': {
                  versions: [
                    {
                      version: '2.1.0',
                      publishedAt: iso,
                      notes: 'Linked source release',
                      workspaceSnapshot: 'b'.repeat(64),
                      deprecated: false,
                      yanked: false,
                    },
                  ],
                  currentVersion: '2.1.0',
                },
              },
            },
          },
        });
      }, ISO);
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(remote.releases.perLink['lw-payments'].currentVersion).toBe('2.1.0');
      expect(remote.releases.perLink['lw-payments'].versions[0].version).toBe('2.1.0');
    },
  );

  test(
    tc(
      wr('Round-trip: Workspace passphrase metadata'),
      'workspace passphrase crypto metadata round-trips',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0022');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const synced = b.getState().synced;
        b.setState({
          synced: {
            ...synced,
            secretCrypto: {
              kdf: 'pbkdf2-sha256-v1',
              salt: 'c2FsdHNhbHRzYWx0',
              iterations: 600000,
              verifier: 'dmVyaWZpZXJ0ZXh0',
            },
          },
        });
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(remote.secretCrypto).toEqual({
        kdf: 'pbkdf2-sha256-v1',
        salt: 'c2FsdHNhbHRzYWx0',
        iterations: 600000,
        verifier: 'dmVyaWZpZXJ0ZXh0',
      });
    },
  );

  test(
    tc(wr('Round-trip: Secret keys / slots metadata'), 'secret key slot metadata round-trips'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0023');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate((iso) => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const synced = b.getState().synced;
        b.setState({
          synced: {
            ...synced,
            secretKeys: {
              'sk-db': {
                id: 'sk-db',
                label: 'Database password',
                salt: 'ZGJzYWx0',
                createdAt: iso,
              },
              'sk-api': { id: 'sk-api', label: 'API key', salt: 'YXBpc2FsdA==', createdAt: iso },
            },
          },
        });
      }, ISO);
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(remote.secretKeys?.['sk-db'].label).toBe('Database password');
      expect(remote.secretKeys?.['sk-db'].salt).toBe('ZGJzYWx0');
      expect(remote.secretKeys?.['sk-api'].label).toBe('API key');
    },
  );
});

test.describe('Workspace restore — workspace shapes', () => {
  test(
    tc(wr('Empty repo init'), 'empty repo init through link → push'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0024');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate(
        async (repo) => {
          const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
          const s = b.getState();
          await s.connectGitHubSession('ghp_mock_test_token');
          await s.connectRepo(repo.owner, repo.name);
          await s.createWorkingBranch();
          await s.pushWorkspace('seed empty workspace');
        },
        { owner: OWNER, name },
      );
      const inspected = await mockGithub.inspectRepo(OWNER, name);
      expect(inspected?.refs).toBeTruthy();
    },
  );

  test(
    tc(wr('Large workspace (10MB JSON)'), 'large multi-folder workspace round-trips through Git'),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0028');
      await mockGithub.seedRepo({ owner: OWNER, name });
      // Scaled down from the literal 10MB workbook target to keep within the
      // Playwright per-test budget — 10 folders × 6 requests still exercises
      // a non-trivial collection tree through the full push/pull wire path.
      // Counts are read back from the store (a fresh workspace already
      // carries one default request) so the assertion compares like for like.
      const counts = await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const s = b.getState();
        for (let f = 0; f < 10; f++) {
          const folderId = s.addFolder(null, `Folder ${f}`);
          for (let r = 0; r < 6; r++) {
            const reqId = s.addRequest(folderId, `Request ${f}-${r}`);
            s.setRequestUrl(reqId, `https://api.example.com/f${f}/r${r}`);
          }
        }
        const synced = b.getState().synced;
        return {
          folders: Object.keys(synced.collections.folders).length,
          requests: Object.keys(synced.collections.requests).length,
        };
      });
      expect(counts.requests).toBeGreaterThanOrEqual(60);
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(Object.keys(remote.collections.folders)).toHaveLength(counts.folders);
      expect(Object.keys(remote.collections.requests)).toHaveLength(counts.requests);
    },
  );

  test(
    tc(
      wr('Repo with secrets references but no passphrase metadata'),
      'secret references without passphrase metadata round-trip',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0027');
      await mockGithub.seedRepo({ owner: OWNER, name });
      await appWithGithubMock.evaluate((iso) => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const synced = b.getState().synced;
        b.setState({
          synced: {
            ...synced,
            // secretKeys present, secretCrypto deliberately null — a valid
            // "secrets referenced, passphrase not yet set" workspace state.
            secretKeys: {
              'sk-token': { id: 'sk-token', label: 'Token', salt: 'dG9rZW5zYWx0', createdAt: iso },
            },
            secretCrypto: null,
            environments: {
              ...synced.environments,
              items: {
                ...synced.environments.items,
                prod: {
                  name: 'prod',
                  variables: [
                    {
                      key: 'TOKEN',
                      value: 'enc:v1:aXY=:Y3Q=',
                      encrypted: true,
                      secretKeyId: 'sk-token',
                    },
                  ],
                },
              },
              priorityOrder: [
                ...synced.environments.priorityOrder,
                { kind: 'local', name: 'prod' },
              ],
            },
          },
        });
      }, ISO);
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(remote.secretKeys?.['sk-token'].label).toBe('Token');
      expect(remote.secretCrypto ?? null).toBeNull();
      expect(remote.environments.items['prod'].variables[0].secretKeyId).toBe('sk-token');
    },
  );

  test(
    tc(
      wr('Workspace with broken refs (request -> deleted folder)'),
      'dangling request → folder ref survives the round-trip intact',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const name = repoName('0029');
      await mockGithub.seedRepo({ owner: OWNER, name });
      const reqId = await appWithGithubMock.evaluate(() => {
        const b = (window as unknown as { __apicircleStore: StoreBridge }).__apicircleStore;
        const s = b.getState();
        const id = s.addRequest(null, 'Orphan request');
        // Point the request at a folder id that does not exist in
        // collections.folders — neither the push serializer nor the remote
        // parser repairs refs, so the dangling pointer should survive.
        const synced = b.getState().synced;
        b.setState({
          synced: {
            ...synced,
            collections: {
              ...synced.collections,
              requests: {
                ...synced.collections.requests,
                [id]: { ...synced.collections.requests[id], folderId: 'deleted-folder-xyz' },
              },
            },
          },
        });
        return id;
      });
      const remote = await pushAndRestore(appWithGithubMock, name);
      expect(remote.collections.requests[reqId].folderId).toBe('deleted-folder-xyz');
      expect(remote.collections.folders['deleted-folder-xyz']).toBeUndefined();
    },
  );
});

// Cells whose product feature does not exist yet — kept as `fixme` with a
// sharp rationale rather than a generic placeholder. Each `wr(...)` call
// still credits the coverage cell to this spec.
test.describe('Workspace restore — not yet automatable', () => {
  test.fixme(
    tc(wr('Round-trip: Request scripts (pre/test) and assertions'), 'request scripts round-trip'),
    () => {
      // The Request type (packages/shared/src/types.ts:244) has no
      // pre-request / test script fields — script execution is not a
      // product feature. The assertions half of this cell rides on the
      // Request.assertions field; split it into its own cell before
      // automating.
    },
  );

  test.fixme(
    tc(wr('Round-trip: Request docs (Markdown)'), 'request markdown docs round-trip'),
    () => {
      // The Request type has no `docs` / description field — per-request
      // Markdown documentation is not a product feature yet.
    },
  );

  test.fixme(
    tc(wr('Round-trip: Request settings (timeout, redirect)'), 'request settings round-trip'),
    () => {
      // The Request type has no per-request `settings` (timeout / redirect
      // policy) field — request-level settings are not a product feature.
    },
  );

  test.fixme(
    tc(wr('Schema version mismatch (newer repo)'), 'newer schemaVersion is handled on pull'),
    () => {
      // parseWorkspaceJson (packages/core/src/git/parseWorkspaceJson.ts) does
      // not branch on schemaVersion, and the store always serialises
      // schemaVersion: 1 — there is no schema-migration-on-pull path to
      // assert against. Needs a raw-workspace.json seeding helper on the
      // git mock plus a product migration path.
    },
  );

  test.fixme(
    tc(wr('Schema version mismatch (older repo)'), 'older schemaVersion is handled on pull'),
    () => {
      // Same gap as the newer-repo cell: no schemaVersion handling on the
      // pull path and no way to push a non-current schemaVersion through
      // the store serializer.
    },
  );
});
