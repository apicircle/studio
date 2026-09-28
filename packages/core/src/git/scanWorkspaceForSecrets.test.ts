import { describe, expect, it } from 'vitest';
import type { Request as ApiRequest, WorkspaceSynced } from '@apicircle/shared';
import demoWorkspace from '../../../../examples/demo-workspace/.apicircle/workspace-demo-workspace-fixture/workspace.json' with { type: 'json' };
import linkedPetsWorkspace from '../../../../examples/linked-pets-api/.apicircle/workspace-linked-pets-api-fixture/workspace.json' with { type: 'json' };
import { redactForGit } from './redactWorkspace';
import {
  SecretsInPushError,
  scanWorkspaceForSecrets,
  unacknowledgedSecretFindings,
  type SecretFinding,
} from './scanWorkspaceForSecrets';

// Fake credentials, assembled so the literals are not flagged by secret
// scanners run over this repository.
const GITHUB_TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const SLACK_TOKEN = 'xoxb-' + '1234567890-abcdefghij';
const PASSWORD = 'hunter2-correct-horse';
const SESSION = 's%3AmT4kQ9vZ2wX8.' + 'Lr7Kp3Nq9Vt1Bx5Cz8Dm2Fh6Gj4';
const CUSTOM = 'cust0m-h3ader-v4lue';
const PLAN_SECRET = 'pl4n-s3cret-v4lue';
const OVERRIDE_SECRET = 'l1nked-0verride-v4lue';
const SECRETS = [
  GITHUB_TOKEN,
  SLACK_TOKEN,
  PASSWORD,
  SESSION,
  CUSTOM,
  PLAN_SECRET,
  OVERRIDE_SECRET,
];

function request(id: string, patch: Partial<ApiRequest>): ApiRequest {
  return {
    id,
    name: id,
    folderId: null,
    method: 'GET',
    url: 'https://api.example.com',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

function workspace(patch: Partial<WorkspaceSynced> = {}): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {}, files: {} },
    mockServers: {},
    meta: { createdAt: 'x', updatedAt: 'x', appVersion: 'test' },
    ...patch,
  };
}

/** A workspace with a secret in every place the scanner looks, and a
 *  harmless neighbour next to each. */
function leakyWorkspace(): WorkspaceSynced {
  return workspace({
    collections: {
      tree: { id: 'root', type: 'root', children: [] },
      folders: {
        auth: { id: 'auth', name: 'Auth', parentId: null },
        admin: {
          id: 'admin',
          name: 'Admin',
          parentId: 'auth',
          auth: { type: 'custom-header', key: 'X-Admin-Key', value: CUSTOM },
        },
      },
      requests: {
        login: request('login', {
          name: 'Login',
          folderId: 'admin',
          url: `https://user:${PASSWORD}@api.example.com/v1/${GITHUB_TOKEN}?access_token=${PASSWORD}&page=2`,
          headers: [
            { key: 'Content-Type', value: 'application/json', enabled: true },
            { key: 'Authorization', value: `Bearer ${GITHUB_TOKEN}`, enabled: true },
            { key: 'X-Api-Key', value: '{{API_KEY}}', enabled: true },
            { key: 'X-Trace', value: SLACK_TOKEN, enabled: false },
          ],
          query: [
            { key: 'api_key', value: PASSWORD, enabled: true },
            { key: 'page', value: '2', enabled: true },
          ],
          cookies: [
            { key: 'connect.sid', value: SESSION, enabled: true },
            { key: 'theme', value: 'dark', enabled: true },
          ],
          contextVars: [{ key: 'refresh_token', value: PASSWORD }],
          auth: { type: 'custom-header', key: 'X-Custom-Auth', value: CUSTOM },
        }),
        health: request('health', { name: 'Health', url: 'https://api.example.com/health' }),
      },
    },
    environments: {
      items: {
        prod: {
          name: 'prod',
          variables: [
            { key: 'BASE_URL', value: 'https://api.example.com', encrypted: false },
            { key: 'API_TOKEN', value: PASSWORD, encrypted: false },
            { key: 'DB_PASSWORD', value: 'enc:v1:abc:def', encrypted: true, secretKeyId: 'k1' },
          ],
        },
      },
      activeName: 'prod',
      priorityOrder: [],
    },
    linkedWorkspaces: {
      lw1: {
        id: 'lw1',
        kind: 'private',
        name: 'Pets API',
      } as unknown as WorkspaceSynced['linkedWorkspaces'][string],
    },
    linkedOverrides: {
      requests: {
        'lw1:getPet': {
          linkedWorkspaceId: 'lw1',
          itemId: 'getPet',
          patch: {
            headers: [{ key: 'Authorization', value: `Bearer ${OVERRIDE_SECRET}`, enabled: true }],
          },
          updatedAt: 'x',
        },
      },
      environmentVars: {
        'lw1:prod:TOKEN': {
          linkedWorkspaceId: 'lw1',
          envName: 'prod',
          varKey: 'TOKEN',
          value: OVERRIDE_SECRET,
          updatedAt: 'x',
        },
        'lw1:prod:HIDDEN': {
          linkedWorkspaceId: 'lw1',
          envName: 'prod',
          varKey: 'HIDDEN_TOKEN',
          removed: true,
          updatedAt: 'x',
        },
      },
    },
    executionPlans: {
      smoke: {
        id: 'smoke',
        name: 'Smoke',
        steps: [],
        envPriorityOrder: [],
        variables: [
          { key: 'client_secret', value: PLAN_SECRET },
          { key: 'region', value: 'eu-west-1' },
        ],
      } as unknown as NonNullable<WorkspaceSynced['executionPlans']>[string],
    },
  });
}

describe('scanWorkspaceForSecrets', () => {
  it('reports every place a secret sits — where and why, in document order', () => {
    const findings = scanWorkspaceForSecrets(leakyWorkspace());
    const login = 'Request "Login" in Auth / Admin';
    expect(findings.map(({ location, reason }) => ({ location, reason }))).toEqual([
      { location: `${login} › URL user info`, reason: 'carries a password' },
      {
        location: `${login} › URL query parameter "access_token"`,
        reason: 'named like a credential',
      },
      { location: `${login} › URL`, reason: 'looks like a GitHub token' },
      { location: `${login} › Header "Authorization"`, reason: 'looks like a GitHub token' },
      { location: `${login} › Header "X-Trace"`, reason: 'looks like a Slack token' },
      { location: `${login} › Query parameter "api_key"`, reason: 'named like a credential' },
      { location: `${login} › Cookie "connect.sid"`, reason: 'named like a credential' },
      {
        location: `${login} › Context variable "refresh_token"`,
        reason: 'named like a credential',
      },
      {
        location: `${login} › Auth header "X-Custom-Auth"`,
        reason: "is sent as the request's authentication",
      },
      {
        location: 'Folder "Auth / Admin" › Auth header "X-Admin-Key"',
        reason: "is sent as the request's authentication",
      },
      { location: 'Environment "prod" › Variable "API_TOKEN"', reason: 'named like a credential' },
      {
        location: 'Linked environment "prod" from "Pets API" › Variable "TOKEN"',
        reason: 'named like a credential',
      },
      {
        location: 'Linked request "getPet" from "Pets API" › Header "Authorization"',
        reason: 'named like a credential',
      },
      { location: 'Plan "Smoke" › Variable "client_secret"', reason: 'named like a credential' },
    ]);
  });

  it('never puts a value in a finding', () => {
    const report = JSON.stringify(scanWorkspaceForSecrets(leakyWorkspace()));
    for (const secret of SECRETS) expect(report).not.toContain(secret);
  });

  it('gives each place a stable id, and a different one to every place', () => {
    const first = scanWorkspaceForSecrets(leakyWorkspace()).map((f) => f.id);
    const second = scanWorkspaceForSecrets(leakyWorkspace()).map((f) => f.id);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
    expect(first).toContain('request:login:Header:1:Authorization');
    expect(first).toContain('environment:prod:variable:1:API_TOKEN');
  });

  it('finds nothing the push would not write: redaction removes URL passwords and auth values', () => {
    const locations = scanWorkspaceForSecrets(redactForGit(leakyWorkspace())).map(
      (f) => f.location,
    );
    expect(locations.some((l) => l.endsWith('URL user info'))).toBe(false);
    expect(locations.some((l) => l.includes('Auth header'))).toBe(false);
    // Free text redaction cannot vouch for is still reported.
    expect(locations).toContain('Request "Login" in Auth / Admin › Header "Authorization"');
  });

  it('finds nothing in a workspace that keeps its secrets in variables and the vault', () => {
    const clean = workspace({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        folders: {},
        requests: {
          r: request('r', {
            url: 'https://{{USER}}:{{PASS}}@api.example.com/v1?page=2&api_key={{API_KEY}}',
            headers: [
              { key: 'Authorization', value: 'Bearer {{TOKEN}}', enabled: true },
              { key: 'Accept', value: 'application/json', enabled: true },
            ],
            cookies: [{ key: 'sessionid', value: '{{SESSION}}', enabled: true }],
            auth: { type: 'custom-header', key: 'X-Key', value: '{{KEY}}' },
          }),
        },
      },
      environments: {
        items: {
          dev: {
            name: 'dev',
            variables: [
              { key: 'TOKEN', value: 'enc:v1:iv:ct', encrypted: true, secretKeyId: 'k' },
              { key: 'TOKEN_URL', value: 'https://idp.example.com/token', encrypted: false },
              { key: 'BEARER_TOKEN', value: 'demo-bearer-token', encrypted: false },
            ],
          },
        },
        activeName: 'dev',
        priorityOrder: [],
      },
    });
    expect(scanWorkspaceForSecrets(clean)).toEqual([]);
  });

  it.each([
    ['the demo workspace', demoWorkspace],
    ['the linked Pets API example', linkedPetsWorkspace],
  ])('finds nothing in %s, so pushing it never prompts', (_name, fixture) => {
    expect(scanWorkspaceForSecrets(fixture as unknown as WorkspaceSynced)).toEqual([]);
  });

  it('tolerates a partially-shaped workspace', () => {
    const partial = {
      collections: {
        requests: { r: { id: 'r', folderId: 'gone' } },
        folders: { loop: { id: 'loop', name: '', parentId: 'loop' } },
      },
      environments: { items: { e: { name: 'e' } } },
      linkedOverrides: {
        requests: { k: { linkedWorkspaceId: 'x', itemId: 'y' } },
        environmentVars: { v: { linkedWorkspaceId: 'x', envName: 'e', varKey: 'TOKEN' } },
      },
      executionPlans: { p: { id: 'p', name: 'P' } },
    } as unknown as WorkspaceSynced;
    expect(scanWorkspaceForSecrets(partial)).toEqual([]);
    expect(scanWorkspaceForSecrets({} as WorkspaceSynced)).toEqual([]);
  });

  it('labels an unnamed row and shortens a very long name', () => {
    const findings = scanWorkspaceForSecrets(
      workspace({
        collections: {
          tree: { id: 'root', type: 'root', children: [] },
          folders: {},
          requests: {
            r: request('r', {
              name: 'x'.repeat(200),
              headers: [{ key: ' ', value: GITHUB_TOKEN, enabled: true }],
            }),
          },
        },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].location).toBe(`Request "${'x'.repeat(79)}…" › Header (unnamed)`);
  });
});

describe('unacknowledgedSecretFindings', () => {
  it('returns the findings whose place was not acknowledged', () => {
    const found = scanWorkspaceForSecrets(leakyWorkspace());
    expect(unacknowledgedSecretFindings(found, found)).toEqual([]);
    expect(unacknowledgedSecretFindings(found, [])).toEqual(found);
    const [, ...rest] = found;
    expect(unacknowledgedSecretFindings(found, rest)).toEqual([found[0]]);
  });
});

describe('SecretsInPushError', () => {
  const finding = (n: number): SecretFinding => ({
    id: `id-${n}`,
    location: `Request "R${n}" › Header "Authorization"`,
    reason: 'named like a credential',
  });

  it('says where, and why, and nothing about the value', () => {
    const error = new SecretsInPushError([finding(1), finding(2)]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SecretsInPushError');
    expect(error.findings).toHaveLength(2);
    expect(error.message).toBe(
      'Push stopped before writing anything: 2 values in this workspace look like secrets and ' +
        'would be written to Git as plain text — Request "R1" › Header "Authorization" (named ' +
        'like a credential); Request "R2" › Header "Authorization" (named like a credential).',
    );
  });

  it('speaks in the singular for one finding', () => {
    expect(new SecretsInPushError([finding(1)]).message).toContain(
      '1 value in this workspace looks like a secret',
    );
  });
});
