import { describe, expect, it } from 'vitest';
import type { Request as ApiRequest, WorkspaceSynced } from '@apicircle/shared';
import {
  resolveRequestForExecution,
  applyLinkedEnvironmentOverrides,
  plaintextEnvMap,
} from './resolveRequest';

function req(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r1',
    name: 'r',
    folderId: null,
    method: 'GET',
    url: 'https://api.example.com/{{path}}',
    headers: [{ key: 'X-Token', value: '{{TOKEN}}', enabled: true }],
    query: [{ key: 'q', value: '{{Q}}', enabled: true }],
    pathParams: [],
    cookies: [],
    body: { type: 'json', content: '{"k":"{{V}}"}' },
    auth: { type: 'bearer', token: '{{TOKEN}}' },
    contextVars: [{ key: 'CTX', value: 'ctxValue' }],
    extractions: [],
    assertions: [],
    createdAt: 't',
    updatedAt: 't',
    ...over,
  } as ApiRequest;
}

function synced(over: Partial<WorkspaceSynced> = {}): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [{ kind: 'local', name: 'dev' }] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: 't', updatedAt: 't', appVersion: '0.1.0' },
    ...over,
  };
}

describe('resolveRequestForExecution', () => {
  it('interpolates url / headers / query / body / auth from envs + secrets', () => {
    const out = resolveRequestForExecution({
      request: req(),
      synced: synced(),
      localEnvs: { dev: { path: 'pets', Q: 'all' } },
      secrets: { TOKEN: 's3cr3t' },
      globalContext: { V: 'val' },
    });
    expect(out.request.url).toBe('https://api.example.com/pets');
    expect(out.request.headers[0].value).toBe('s3cr3t');
    expect(out.request.query[0].value).toBe('all');
    expect((out.request.body as { content: string }).content).toBe('{"k":"val"}');
    expect((out.request.auth as { token: string }).token).toBe('s3cr3t');
    expect(out.missing).toEqual([]);
  });

  it('reports missing placeholders without dropping the text', () => {
    const out = resolveRequestForExecution({
      request: req({ url: 'https://api/{{NOPE}}' }),
      synced: synced(),
      localEnvs: { dev: {} },
    });
    expect(out.request.url).toBe('https://api/{{NOPE}}');
    expect(out.missing).toContain('NOPE');
  });

  it('contextVars beats env which beats secrets', () => {
    const out = resolveRequestForExecution({
      request: req({ contextVars: [{ key: 'X', value: 'fromCtx' }], url: '{{X}}' }),
      synced: synced(),
      localEnvs: { dev: { X: 'fromEnv' } },
      secrets: { X: 'fromSecret' },
    });
    expect(out.request.url).toBe('fromCtx');
  });

  it('linked envs become first-class via composite priority keys', () => {
    const out = resolveRequestForExecution({
      request: req({ url: '{{X}}' }),
      synced: synced({
        environments: {
          items: {},
          activeName: null,
          priorityOrder: [{ kind: 'linked', linkedWorkspaceId: 'lw1', envName: 'dev' }],
        },
      }),
      localEnvs: {},
      linkedEnvs: { lw1: { dev: { X: 'fromLinkedDev' } } },
    });
    expect(out.request.url).toBe('fromLinkedDev');
  });
});

describe('applyLinkedEnvironmentOverrides + plaintextEnvMap', () => {
  it('replaces, removes, and injects variables per linkedOverrides', () => {
    const source = {
      items: {
        dev: {
          name: 'dev',
          variables: [
            { key: 'KEEP', value: 'src1', encrypted: false },
            { key: 'OVERRIDE', value: 'src2', encrypted: false },
            { key: 'GONE', value: 'src3', encrypted: false },
          ],
        },
      },
      activeName: null,
      priorityOrder: [],
    } as WorkspaceSynced['environments'];
    const s = synced({
      linkedOverrides: {
        requests: {},
        environmentVars: {
          'lw1:dev:OVERRIDE': {
            linkedWorkspaceId: 'lw1',
            envName: 'dev',
            varKey: 'OVERRIDE',
            value: 'mine',
            updatedAt: 't',
          },
          'lw1:dev:GONE': {
            linkedWorkspaceId: 'lw1',
            envName: 'dev',
            varKey: 'GONE',
            removed: true,
            updatedAt: 't',
          },
          'lw1:dev:NEW': {
            linkedWorkspaceId: 'lw1',
            envName: 'dev',
            varKey: 'NEW',
            value: 'newVal',
            updatedAt: 't',
          },
        },
      },
    });
    const applied = applyLinkedEnvironmentOverrides(source, 'lw1', s);
    const flat = plaintextEnvMap(applied);
    expect(flat.dev.KEEP).toBe('src1');
    expect(flat.dev.OVERRIDE).toBe('mine');
    expect(flat.dev.GONE).toBeUndefined();
    expect(flat.dev.NEW).toBe('newVal');
  });

  it('plaintextEnvMap drops encrypted rows (host should pre-decrypt)', () => {
    const source = {
      items: {
        dev: {
          name: 'dev',
          variables: [
            { key: 'PLAIN', value: 'p', encrypted: false },
            { key: 'SECRET', value: 'cipher', encrypted: true },
          ],
        },
      },
      activeName: null,
      priorityOrder: [],
    } as WorkspaceSynced['environments'];
    expect(plaintextEnvMap(source).dev).toEqual({ PLAIN: 'p' });
  });
});
