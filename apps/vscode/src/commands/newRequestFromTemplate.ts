import * as vscode from 'vscode';
import { generateId } from '@apicircle/shared';
import type { Folder, Request as ApiRequest, RequestAuth, RequestBody } from '@apicircle/shared';
import type { WorkspacePatch } from '@apicircle/core';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import { uniquifyName } from '../util/uniquifyName';

// =============================================================================
// `API Circle: New Request from Template…` — scaffolds a starter request (or a
// folder of starter requests) from a curated list of common API shapes. Lets a
// user skip the New-Request wizard's auth/url drilldown when they already know
// the shape they want.
//
// Templates ship intentionally minimal — they're starting points the user
// adjusts in the YAML editor, not opinionated framework presets. The CRUD
// scaffold creates a folder of five requests so a five-line `for each
// resource` is one click away from a real workspace.
// =============================================================================

interface SingleRequestTemplate {
  kind: 'single';
  id: string;
  label: string;
  description: string;
  build: () => Omit<ApiRequest, 'id' | 'folderId' | 'createdAt' | 'updatedAt'>;
}

interface CrudTemplate {
  kind: 'crud';
  id: string;
  label: string;
  description: string;
  build: (
    resource: string,
  ) => Array<Omit<ApiRequest, 'id' | 'folderId' | 'createdAt' | 'updatedAt'>>;
}

type Template = SingleRequestTemplate | CrudTemplate;

const TEMPLATES: Template[] = [
  {
    kind: 'single',
    id: 'simple-get',
    label: '$(globe) Simple GET',
    description: 'Plain GET request — no auth, no body.',
    build: () => ({
      name: 'Get example',
      method: 'GET',
      url: 'https://api.example.com/resource',
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
    }),
  },
  {
    kind: 'single',
    id: 'json-post',
    label: '$(json) JSON POST',
    description: 'POST with a JSON body and Content-Type header.',
    build: () => ({
      name: 'Create example',
      method: 'POST',
      url: 'https://api.example.com/resource',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      query: [],
      body: {
        type: 'json',
        content: JSON.stringify({ name: 'New resource', value: 0 }, null, 2),
      },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
    }),
  },
  {
    kind: 'single',
    id: 'bearer-get',
    label: '$(key) Bearer-protected GET',
    description: 'GET request behind a Bearer token (uses {{auth_token}}).',
    build: () => ({
      name: 'Get protected resource',
      method: 'GET',
      url: 'https://api.example.com/me',
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      auth: { type: 'bearer', token: '{{auth_token}}' },
      contextVars: [],
      extractions: [],
      assertions: [],
    }),
  },
  {
    kind: 'single',
    id: 'paginated',
    label: '$(list-ordered) Paginated GET',
    description: 'GET with `page` + `limit` query params for cursor / offset pagination.',
    build: () => ({
      name: 'List resources (paginated)',
      method: 'GET',
      url: 'https://api.example.com/resource',
      headers: [],
      query: [
        { key: 'page', value: '1', enabled: true },
        { key: 'limit', value: '20', enabled: true },
      ],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
    }),
  },
  {
    kind: 'single',
    id: 'graphql',
    label: '$(symbol-namespace) GraphQL query',
    description: 'POST to a GraphQL endpoint with a query body.',
    build: () => ({
      name: 'GraphQL query',
      method: 'POST',
      url: 'https://api.example.com/graphql',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      query: [],
      body: {
        type: 'graphql',
        content: 'query Me {\n  me {\n    id\n    name\n  }\n}',
        variables: '{}',
      } satisfies RequestBody,
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
    }),
  },
  {
    kind: 'crud',
    id: 'rest-crud',
    label: '$(folder-library) REST CRUD scaffold',
    description:
      'Creates a folder with List / Get / Create / Update / Delete requests for a resource.',
    build: (resource: string) => {
      const single = `https://api.example.com/${resource}/{{id}}`;
      const collection = `https://api.example.com/${resource}`;
      const blank = {
        headers: [] as ApiRequest['headers'],
        query: [] as ApiRequest['query'],
        contextVars: [],
        extractions: [],
        assertions: [],
        auth: { type: 'none' } as RequestAuth,
      };
      return [
        {
          ...blank,
          name: `List ${resource}`,
          method: 'GET',
          url: collection,
          body: { type: 'none', content: '' },
        },
        {
          ...blank,
          name: `Get ${resource}`,
          method: 'GET',
          url: single,
          body: { type: 'none', content: '' },
        },
        {
          ...blank,
          name: `Create ${resource}`,
          method: 'POST',
          url: collection,
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
          body: { type: 'json', content: JSON.stringify({ name: 'New' }, null, 2) },
        },
        {
          ...blank,
          name: `Update ${resource}`,
          method: 'PATCH',
          url: single,
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
          body: { type: 'json', content: JSON.stringify({ name: 'Renamed' }, null, 2) },
        },
        {
          ...blank,
          name: `Delete ${resource}`,
          method: 'DELETE',
          url: single,
          body: { type: 'none', content: '' },
        },
      ];
    },
  },
];

export interface NewRequestFromTemplateDeps {
  bridge: VsCodeBridge;
  /** Test-only hook used to inspect the create result instead of opening the YAML. */
  openCreated?: (uri: vscode.Uri) => Promise<void>;
}

export async function newRequestFromTemplateCommand(
  deps: NewRequestFromTemplateDeps,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }

  const pick = await vscode.window.showQuickPick(
    TEMPLATES.map((t) => ({ label: t.label, description: t.description, value: t.id })),
    {
      title: 'New request from template',
      placeHolder: 'Pick a starter shape — you can tweak the YAML afterwards.',
    },
  );
  if (!pick) return;
  const template = TEMPLATES.find((t) => t.id === pick.value);
  if (!template) return;

  const state = await active.read();
  const folderOptions = [
    { label: '(top level)', folderId: null as string | null },
    ...Object.values(state.synced.collections.folders).map((f) => ({
      label: f.name,
      folderId: f.id,
    })),
  ];

  if (template.kind === 'single') {
    const folderPick = await vscode.window.showQuickPick(folderOptions, {
      placeHolder: 'Destination folder',
    });
    if (!folderPick) return;
    const now = new Date().toISOString();
    const built = template.build();
    const reqName = uniquifyName(state.synced, folderPick.folderId, 'request', built.name);
    const request: ApiRequest = {
      id: generateId(),
      folderId: folderPick.folderId,
      createdAt: now,
      updatedAt: now,
      ...built,
      name: reqName,
    };
    await active.apply({ kind: 'request.create', request });
    const stateSingle = await active.read();
    const uri = ApicircleFsProvider.requestUri(
      active.workspace.id,
      request,
      stateSingle.synced.collections.folders,
      stateSingle.synced.collections.requests,
    );
    if (deps.openCreated) await deps.openCreated(uri);
    else await vscode.commands.executeCommand('vscode.open', uri);
    return;
  }

  // CRUD scaffold: ask for the resource name + parent folder, create a new
  // folder, then create all five requests inside it.
  const resource = await vscode.window.showInputBox({
    prompt: 'Resource name (used in URL paths)',
    placeHolder: 'users',
    validateInput: (v) => {
      const trimmed = v.trim();
      if (trimmed.length === 0) return 'Resource name is required.';
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(trimmed)) {
        return 'Use letters, digits, _ or - only (must start with a letter).';
      }
      return null;
    },
  });
  if (resource === undefined) return;

  const parentPick = await vscode.window.showQuickPick(folderOptions, {
    placeHolder: 'Parent folder for the CRUD group',
  });
  if (!parentPick) return;

  const now = new Date().toISOString();
  const folderName = uniquifyName(
    state.synced,
    parentPick.folderId,
    'folder',
    `${resource} (CRUD)`,
  );
  const folder: Folder = {
    id: generateId(),
    name: folderName,
    parentId: parentPick.folderId,
  };
  const requests: ApiRequest[] = template.build(resource.trim()).map((built) => ({
    id: generateId(),
    folderId: folder.id,
    createdAt: now,
    updatedAt: now,
    ...built,
  }));

  const patches: WorkspacePatch[] = [
    { kind: 'folder.create', folder },
    ...requests.map<WorkspacePatch>((request) => ({ kind: 'request.create', request })),
  ];
  for (const patch of patches) {
    await active.apply(patch);
  }

  const firstRequest = requests[0];
  if (firstRequest) {
    const stateCrud = await active.read();
    const uri = ApicircleFsProvider.requestUri(
      active.workspace.id,
      firstRequest,
      stateCrud.synced.collections.folders,
      stateCrud.synced.collections.requests,
    );
    if (deps.openCreated) await deps.openCreated(uri);
    else await vscode.commands.executeCommand('vscode.open', uri);
  }
}
