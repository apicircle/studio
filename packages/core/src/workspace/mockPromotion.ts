// buildMockPromotion — the single source of truth for turning mock endpoints
// into runnable collection requests, shared by the web/desktop store, the MCP
// server, and the VS Code extension. It reads the current `synced` (to merge an
// existing "Mock" env + reuse an existing "<name> (mock)" folder) and returns
// the ordered `WorkspacePatch` sequence for the caller to apply through its own
// `applyMutation` / provider path. Pure: no persistence, no IDB, no network.

import type {
  Environment,
  Folder,
  MockEndpoint,
  MockServer,
  Request as ApiRequest,
  WorkspaceSynced,
} from '@apicircle/shared';
import {
  generateId,
  MOCK_ENV_NAME,
  mockEnvVarDefaults,
  mockFolderName,
  MOCK_URL_PREFIX,
  requestShapeFromMockEndpoint,
} from '@apicircle/shared';
import type { WorkspacePatch } from './patches';

export interface MockPromotionOptions {
  /** Folder to nest the "<name> (mock)" folder under. Defaults to the root. */
  parentFolderId?: string | null;
  /** ISO timestamp stamped into created requests. Injectable for tests. */
  now?: string;
}

export interface MockPromotionResult {
  /** Apply these in order (env upsert + activate, folder create, requests). */
  patches: WorkspacePatch[];
  /** Id of the "<name> (mock)" folder the requests land in (new or reused). */
  folderId: string;
  /** Ids of the created requests, one per input endpoint, in order. */
  requestIds: string[];
  /** Name of the environment ensured (always {@link MOCK_ENV_NAME}). */
  envName: string;
}

export function buildMockPromotion(
  synced: WorkspaceSynced,
  mock: MockServer,
  endpoints: MockEndpoint[],
  options: MockPromotionOptions = {},
): MockPromotionResult {
  const parentFolderId = options.parentFolderId ?? null;
  const now = options.now ?? new Date().toISOString();
  const patches: WorkspacePatch[] = [];

  // 1) Ensure the shared "Mock" environment: merge the host/port defaults into
  //    any existing same-name env (preserving edited values), then activate it.
  const existingEnv = synced.environments.items[MOCK_ENV_NAME];
  const variables = existingEnv ? [...existingEnv.variables] : [];
  for (const [key, value] of mockEnvVarDefaults(mock.defaultPort)) {
    if (!variables.some((v) => v.key === key)) variables.push({ key, value, encrypted: false });
  }
  const environment: Environment = { name: MOCK_ENV_NAME, variables };
  patches.push({ kind: 'environment.upsert', environment });
  patches.push({ kind: 'environment.setActive', name: MOCK_ENV_NAME });

  // 2) Find-or-create the "<name> (mock)" folder under parentFolderId so
  //    re-promoting the same mock reuses one folder.
  const folderName = mockFolderName(mock.name);
  const existingFolder = Object.values(synced.collections.folders).find(
    (f) => f.name === folderName && f.parentId === parentFolderId,
  );
  let folderId: string;
  if (existingFolder) {
    folderId = existingFolder.id;
  } else {
    folderId = generateId();
    const folder: Folder = { id: folderId, name: folderName, parentId: parentFolderId };
    patches.push({ kind: 'folder.create', folder });
  }

  // 3) One request per endpoint, targeting the live mock via the templated URL.
  const requestIds: string[] = [];
  for (const ep of endpoints) {
    const id = generateId();
    requestIds.push(id);
    const request: ApiRequest = {
      id,
      name: ep.name || `${ep.method} ${ep.pathPattern}`,
      folderId,
      ...requestShapeFromMockEndpoint(ep, MOCK_URL_PREFIX),
      cookies: [],
      body: { type: 'none', content: '' },
      // `inherit` so a request picks up folder auth; resolves to none at the
      // root where the mock folder has no auth.
      auth: { type: 'inherit' },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: now,
      updatedAt: now,
    };
    patches.push({ kind: 'request.create', request });
  }

  return { patches, folderId, requestIds, envName: MOCK_ENV_NAME };
}
