// IDB synthetic-state seeder (S3). Writes a fully-shaped WorkspaceSynced
// + WorkspaceLocal + WorkspaceRegistry into the browser's IndexedDB so
// the app hydrates with a known workspace on next navigation.
//
// Two entry points:
//
//   seedAndOpen(page, variant)
//     For tests that start cold. Navigates to `/oauth-callback.html`
//     (a same-origin static asset that doesn't boot the React app),
//     writes the seed records, then navigates to `/`.
//
//   seedWorkspace(page, variant)
//     For tests that already have the app loaded. Clears IDB, writes the
//     seed, then reloads — useful when a single test needs to compare
//     pre- and post-seed state.
//
// Variants:
//   - 'empty'        — single workspace, zero entities.
//   - 'seeded'       — 1 folder, 2 requests (one with bodySchemaId + JSON
//                      body, one with bearer auth using {{token}}),
//                      2 envs (Dev/Prod), 1 plan over both requests,
//                      1 manual mock server, 1 global schema. The shape
//                      covers Reference-Safety / Delete-Safety scenarios.
//   - 'with-secrets' — same as `seeded` + a secretKey meta + secretCrypto
//                      verifier. Drives the hydrate-passphrase prompt.
//   - 'large-1k'     — 1000 requests across 50 folders. Perf test data.
//
// IDs are deterministic per-variant so specs can assert against them
// directly. Use `seedIds(variant)` to read them without seeding.
//
// The seeder builds everything from `@apicircle/shared` types — adding a
// field to `WorkspaceSynced` typically requires a one-line fix here, not
// a fresh fixture audit.

import type {
  ContextExtraction,
  Environment,
  ExecutionPlan,
  Folder,
  GlobalSchema,
  MockServer,
  Request as ApiRequest,
  RequestBody,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const DB_NAME = 'apicircle-workspace';
const DB_VERSION = 3;

export type SeedVariant = 'empty' | 'seeded' | 'with-secrets' | 'large-1k';

export interface WorkspaceRegistryShape {
  schemaVersion: 1;
  activeWorkspaceId: string;
  workspaces: Array<{
    id: string;
    name: string;
    lastOpenedAt: string;
    createdAt: string;
  }>;
}

export interface SeedIds {
  workspaceId: string;
  rootFolderId: string;
  folderId: string;
  requestIds: string[];
  envNames: string[];
  planId: string;
  mockServerId: string;
  schemaId: string;
  secretKeyId: string;
}

export interface SeedData {
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
  registry: WorkspaceRegistryShape;
  ids: SeedIds;
}

// Deterministic IDs so specs can reference them without round-tripping
// through the seed return. FNV-1a-ish hash → base36; the slug prefix
// guarantees that two labels never collide even on hash hits.
function detId(variant: SeedVariant, label: string): string {
  let h = 0x811c9dc5;
  const s = `${variant}::${label}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const slug = label
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 10)
    .toLowerCase();
  return `seed-${slug}-${(h >>> 0).toString(36)}`;
}

const NOW = '2026-05-15T12:00:00.000Z';

function makeRequest(o: Partial<ApiRequest> & Pick<ApiRequest, 'id' | 'name'>): ApiRequest {
  const body: RequestBody = o.body ?? { type: 'none', content: '' };
  return {
    folderId: null,
    method: 'GET',
    url: 'https://httpbin.org/anything',
    headers: [],
    query: [],
    body,
    auth: { type: 'inherit' },
    contextVars: [],
    extractions: [] as ContextExtraction[],
    assertions: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
  };
}

function makeFolder(o: Partial<Folder> & Pick<Folder, 'id' | 'name'>): Folder {
  return { parentId: null, ...o };
}

function makeEnv(name: string, variables: Environment['variables']): Environment {
  return { name, variables };
}

function makePlan(o: Partial<ExecutionPlan> & Pick<ExecutionPlan, 'id' | 'name'>): ExecutionPlan {
  return {
    steps: [],
    envPriorityOrder: [],
    ...o,
  };
}

function makeSchema(id: string, name: string, json: string): GlobalSchema {
  return { id, name, schema: json, createdAt: NOW, updatedAt: NOW };
}

function makeMockServer(o: Partial<MockServer> & Pick<MockServer, 'id' | 'name'>): MockServer {
  // MockServer.source is a union; we want a `kind: 'manual'` shape. Cast
  // is local — the broader type stays correct everywhere else.
  const source: MockServer['source'] = (o.source ?? {
    kind: 'manual',
    endpoints: [],
  }) as MockServer['source'];
  // The MockServer type mirrors manual endpoints into BOTH `source.endpoints`
  // and the top-level `endpoints` table — and `normalizeSyncedShape` on
  // hydrate rebuilds `source.endpoints` FROM the top-level `endpoints`.
  // So a seed that only fills `source.endpoints` loses them on reload.
  // Keep the two in sync here.
  const endpoints: MockServer['endpoints'] =
    o.endpoints ?? (source.kind === 'manual' ? source.endpoints : []);
  return {
    defaultPort: null,
    cors: { enabled: false, origins: [] },
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
    source: source.kind === 'manual' ? { ...source, endpoints } : source,
    endpoints,
  };
}

function emptyLocal(workspaceId: string, activeRequestId: string | null): WorkspaceLocal {
  return {
    schemaVersion: 1,
    workspaceId,
    executionPlans: {},
    history: { requestRuns: [], planRuns: [] },
    secretIndex: { entries: {} },
    sessions: { github: { workspace: null, links: {} } },
    connectedRepo: null,
    workingBranch: null,
    seededWorkspaceSha: null,
    retiredBranch: null,
    sync: {
      lastPulledSnapshot: null,
      lastPulledSha: null,
      lastPulledAt: null,
      dirtyKeys: [],
    },
    linkedCollections: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: {
      activeRequestId,
      sidebarExpandedSections: [],
      themeId: 'studio-dark',
      fontId: 'system-mono',
      fontSizePercent: 100,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
}

function registryFor(workspaceId: string, name: string): WorkspaceRegistryShape {
  return {
    schemaVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [{ id: workspaceId, name, lastOpenedAt: NOW, createdAt: NOW }],
  };
}

function buildEmpty(): SeedData {
  const workspaceId = detId('empty', 'workspace');
  const rootFolderId = detId('empty', 'rootFolder');
  const synced: WorkspaceSynced = {
    schemaVersion: 1,
    workspaceId,
    collections: {
      tree: { id: rootFolderId, type: 'root', children: [] },
      requests: {},
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    executionPlans: {},
    secretKeys: {},
    secretCrypto: null,
    meta: { createdAt: NOW, updatedAt: NOW, appVersion: '0.1.0' },
  };
  return {
    synced,
    local: emptyLocal(workspaceId, null),
    registry: registryFor(workspaceId, 'Empty Workspace'),
    ids: {
      workspaceId,
      rootFolderId,
      folderId: '',
      requestIds: [],
      envNames: [],
      planId: '',
      mockServerId: '',
      schemaId: '',
      secretKeyId: '',
    },
  };
}

function buildSeeded(variant: 'seeded' | 'with-secrets'): SeedData {
  const workspaceId = detId(variant, 'workspace');
  const rootFolderId = detId(variant, 'rootFolder');
  const folderId = detId(variant, 'folder-users');
  const r1Id = detId(variant, 'request-get-user');
  const r2Id = detId(variant, 'request-create-user');
  const planId = detId(variant, 'plan-smoke');
  const mockServerId = detId(variant, 'mock-users');
  const schemaId = detId(variant, 'schema-user');
  const secretKeyId = detId(variant, 'secret-token');

  const folder = makeFolder({ id: folderId, name: 'Users' });

  const r1 = makeRequest({
    id: r1Id,
    name: 'Get user',
    folderId,
    method: 'GET',
    url: 'https://httpbin.org/get?id={{id}}',
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
    auth: { type: 'inherit' },
    bodySchemaId: schemaId,
  });
  const r2 = makeRequest({
    id: r2Id,
    name: 'Create user',
    folderId,
    method: 'POST',
    url: 'https://httpbin.org/post',
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    auth: { type: 'bearer', token: '{{token}}' },
    body: { type: 'json', content: '{"name":"alice"}' },
  });

  const tokenVar: Environment['variables'][number] = {
    key: 'token',
    value: variant === 'with-secrets' ? '' : 'plaintext-dev-token',
    encrypted: variant === 'with-secrets',
    ...(variant === 'with-secrets' ? { secretKeyId } : {}),
  };

  const envs: Record<string, Environment> = {
    Dev: makeEnv('Dev', [
      { key: 'baseUrl', value: 'https://httpbin.org', encrypted: false },
      { key: 'id', value: '1', encrypted: false },
      tokenVar,
    ]),
    Prod: makeEnv('Prod', [
      { key: 'baseUrl', value: 'https://api.example.com', encrypted: false },
      { key: 'id', value: '42', encrypted: false },
    ]),
  };

  const plan = makePlan({
    id: planId,
    name: 'Smoke',
    steps: [
      { requestId: r1Id, enabled: true },
      { requestId: r2Id, enabled: true },
    ],
    envPriorityOrder: [{ kind: 'local', name: 'Dev' }],
  });

  const usersEndpoint: MockServer['endpoints'][number] = {
    id: 'e1',
    name: 'GET /users/:id',
    method: 'GET',
    pathPattern: '/users/:id',
    requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
    requestValidation: [],
    responseRules: [],
    defaultResponse: {
      status: 200,
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: { type: 'json', content: '{"id":"{id}","name":"alice"}' },
    },
  };
  const mockServer = makeMockServer({
    id: mockServerId,
    name: 'Users Mock',
    source: { kind: 'manual', endpoints: [usersEndpoint] },
    endpoints: [usersEndpoint],
  });

  const schema = makeSchema(
    schemaId,
    'User',
    '{"type":"object","required":["name"],"properties":{"id":{"type":"integer"},"name":{"type":"string"}}}',
  );

  const synced: WorkspaceSynced = {
    schemaVersion: 1,
    workspaceId,
    collections: {
      tree: {
        id: rootFolderId,
        type: 'root',
        children: [{ kind: 'folder', id: folderId }],
      },
      requests: { [r1Id]: r1, [r2Id]: r2 },
      folders: { [folderId]: folder },
    },
    environments: {
      items: envs,
      activeName: 'Dev',
      priorityOrder: [
        { kind: 'local', name: 'Dev' },
        { kind: 'local', name: 'Prod' },
      ],
    },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: { [schemaId]: schema }, graphql: {} },
    mockServers: { [mockServerId]: mockServer },
    executionPlans: { [planId]: plan },
    secretKeys:
      variant === 'with-secrets'
        ? {
            [secretKeyId]: {
              id: secretKeyId,
              label: 'TOKEN',
              salt: 'AAECAwQFBgcICQoLDA0ODw==',
              createdAt: NOW,
            },
          }
        : {},
    // Verifier is a real base64-encoded 12 bytes — the hydrate path won't
    // try to decrypt anything (no encrypted payloads are seeded), so the
    // verifier only has to round-trip cleanly. The seeded passphrase is
    // intentionally unknown so the "wrong passphrase" test can validate
    // the failure path.
    secretCrypto:
      variant === 'with-secrets'
        ? {
            kdf: 'pbkdf2-sha256-v1',
            salt: 'AAECAwQFBgcICQoLDA0ODw==',
            iterations: 100_000,
            verifier: 'EAAREiM0RVZneIme',
          }
        : null,
    meta: { createdAt: NOW, updatedAt: NOW, appVersion: '0.1.0' },
  };

  return {
    synced,
    local: emptyLocal(workspaceId, r1Id),
    registry: registryFor(
      workspaceId,
      variant === 'with-secrets' ? 'Workspace with secrets' : 'Seeded Workspace',
    ),
    ids: {
      workspaceId,
      rootFolderId,
      folderId,
      requestIds: [r1Id, r2Id],
      envNames: ['Dev', 'Prod'],
      planId,
      mockServerId,
      schemaId,
      secretKeyId,
    },
  };
}

function buildLarge1k(): SeedData {
  const workspaceId = detId('large-1k', 'workspace');
  const rootFolderId = detId('large-1k', 'rootFolder');
  const FOLDERS = 50;
  const REQS_PER = 20; // 50 × 20 = 1000

  const folders: Record<string, Folder> = {};
  const requests: Record<string, ApiRequest> = {};
  const treeChildren: Array<{ kind: 'folder' | 'request'; id: string }> = [];
  const requestIds: string[] = [];

  for (let fi = 0; fi < FOLDERS; fi++) {
    const folderId = detId('large-1k', `folder-${fi}`);
    folders[folderId] = makeFolder({
      id: folderId,
      name: `Folder ${fi.toString().padStart(2, '0')}`,
    });
    treeChildren.push({ kind: 'folder', id: folderId });
    for (let ri = 0; ri < REQS_PER; ri++) {
      const id = detId('large-1k', `request-${fi}-${ri}`);
      requestIds.push(id);
      requests[id] = makeRequest({
        id,
        name: `Request ${fi}-${ri}`,
        folderId,
        method: 'GET',
        url: `https://httpbin.org/anything/${fi}/${ri}`,
      });
    }
  }

  const synced: WorkspaceSynced = {
    schemaVersion: 1,
    workspaceId,
    collections: {
      tree: { id: rootFolderId, type: 'root', children: treeChildren },
      requests,
      folders,
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    executionPlans: {},
    secretKeys: {},
    secretCrypto: null,
    meta: { createdAt: NOW, updatedAt: NOW, appVersion: '0.1.0' },
  };

  return {
    synced,
    local: emptyLocal(workspaceId, null),
    registry: registryFor(workspaceId, 'Large Workspace (1k requests)'),
    ids: {
      workspaceId,
      rootFolderId,
      folderId: '',
      requestIds,
      envNames: [],
      planId: '',
      mockServerId: '',
      schemaId: '',
      secretKeyId: '',
    },
  };
}

export function buildSeed(variant: SeedVariant): SeedData {
  switch (variant) {
    case 'empty':
      return buildEmpty();
    case 'seeded':
    case 'with-secrets':
      return buildSeeded(variant);
    case 'large-1k':
      return buildLarge1k();
  }
}

/** Read the deterministic IDs without seeding. */
export function seedIds(variant: SeedVariant): SeedIds {
  return buildSeed(variant).ids;
}

async function writeSeedToIdb(page: Page, data: SeedData): Promise<void> {
  await page.evaluate(
    async ({ dbName, dbVersion, synced, local, registry }) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('synced')) d.createObjectStore('synced');
          if (!d.objectStoreNames.contains('local')) d.createObjectStore('local');
          if (!d.objectStoreNames.contains('registry')) d.createObjectStore('registry');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['synced', 'local', 'registry'], 'readwrite');
        tx.objectStore('synced').clear();
        tx.objectStore('local').clear();
        tx.objectStore('registry').clear();
        tx.objectStore('synced').put(synced, (synced as { workspaceId: string }).workspaceId);
        tx.objectStore('local').put(local, (local as { workspaceId: string }).workspaceId);
        tx.objectStore('registry').put(registry, 'meta');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    },
    {
      dbName: DB_NAME,
      dbVersion: DB_VERSION,
      synced: data.synced as unknown as Record<string, unknown>,
      local: data.local as unknown as Record<string, unknown>,
      registry: data.registry,
    },
  );
}

/**
 * Cold-start path: navigate to a same-origin static asset, write the
 * seed, then navigate to the app. Use this at the START of a test BEFORE
 * any `app.goto('/')`. Pairs with a plain `page` fixture — don't use the
 * `app` fixture (which itself navigates to `/`).
 */
export async function seedAndOpen(
  page: Page,
  variant: SeedVariant,
  appUrl = '/',
): Promise<SeedIds> {
  const seed = buildSeed(variant);
  // /oauth-callback.html is a same-origin static asset — page.evaluate
  // can open the IDB scoped to localhost without booting the React app.
  await page.goto('/oauth-callback.html');
  await writeSeedToIdb(page, seed);
  await page.goto(appUrl);
  await expect(page.getByText('API Circle Studio', { exact: true })).toBeVisible();
  return seed.ids;
}

/**
 * Reseed an already-loaded app. Clears IDB, writes the seed, reloads,
 * and waits for the brand text to reappear. Use this when a single test
 * needs to mutate from one seeded state to another.
 */
export async function seedWorkspace(page: Page, variant: SeedVariant): Promise<SeedIds> {
  const seed = buildSeed(variant);
  await writeSeedToIdb(page, seed);
  await page.reload();
  await expect(page.getByText('API Circle Studio', { exact: true })).toBeVisible();
  return seed.ids;
}
