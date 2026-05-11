import { describe, expect, it } from 'vitest';
import type { WorkspaceSynced } from '@apicircle/shared';
import { serializeWorkspaceForGit } from './serializeWorkspace';

const empty: WorkspaceSynced = {
  schemaVersion: 1,
  workspaceId: 'ws-1',
  workspaceName: 'My Workspace',
  collections: {
    tree: { id: 'root', type: 'root', children: [] },
    requests: {},
    folders: {},
  },
  environments: { items: {}, activeName: null, priorityOrder: [] },
  linkedWorkspaces: {},
  linkedOverrides: { requests: {}, environmentVars: {} },
  releases: { self: null, perLink: {} },
  globalAssets: { schemas: {}, graphql: {} },
  mockServers: {},
  meta: {
    createdAt: '2026-04-27T00:00:00.000Z',
    updatedAt: '2026-04-27T00:00:00.000Z',
    appVersion: '0.1.0',
  },
};

describe('serializeWorkspaceForGit', () => {
  it('stringifies with 2-space indent and a trailing newline', () => {
    const out = serializeWorkspaceForGit(empty);
    expect(out.endsWith('\n')).toBe(true);
    expect(out).toContain('  "schemaVersion": 1');
  });

  it('produces byte-identical output for two semantically equal docs with different key order', () => {
    const reordered: WorkspaceSynced = {
      meta: empty.meta,
      releases: empty.releases,
      globalAssets: empty.globalAssets,
      mockServers: empty.mockServers,
      linkedOverrides: empty.linkedOverrides,
      linkedWorkspaces: empty.linkedWorkspaces,
      environments: empty.environments,
      collections: empty.collections,
      workspaceName: empty.workspaceName,
      workspaceId: empty.workspaceId,
      schemaVersion: 1,
    };
    expect(serializeWorkspaceForGit(reordered)).toBe(serializeWorkspaceForGit(empty));
  });

  it('preserves array order (priority list, tree children, etc.)', () => {
    const withOrder: WorkspaceSynced = {
      ...empty,
      environments: {
        items: {
          dev: { name: 'dev', variables: [] },
          prod: { name: 'prod', variables: [] },
        },
        activeName: 'dev',
        priorityOrder: [
          { kind: 'local', name: 'prod' },
          { kind: 'local', name: 'dev' },
        ],
      },
    };
    const out = serializeWorkspaceForGit(withOrder);
    // Priority list is an array — order is user-visible and must round-
    // trip verbatim. Each entry is now a refs object `{kind, name}`, so
    // the order check looks at the sequence of `name` strings.
    const priorityIdx = out.indexOf('"priorityOrder"');
    expect(priorityIdx).toBeGreaterThan(-1);
    const slice = out.slice(priorityIdx);
    const prodIdx = slice.indexOf('"prod"');
    const devIdx = slice.indexOf('"dev"');
    expect(prodIdx).toBeGreaterThan(-1);
    expect(devIdx).toBeGreaterThan(-1);
    expect(prodIdx).toBeLessThan(devIdx);
    // ...but the keys of `environments` and its sub-objects ARE sorted.
    expect(out.indexOf('"activeName"')).toBeLessThan(out.indexOf('"items"'));
  });

  it('round-trips linkedWorkspaces + linkedOverrides verbatim through serialize → parse', () => {
    const T0 = '2026-04-27T00:00:00.000Z';
    const populated: WorkspaceSynced = {
      ...empty,
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
          linkedAt: T0,
          requiredSecretKeyIds: ['DB_TOKEN'],
        },
      },
      linkedOverrides: {
        requests: {
          'lw-1:r1': {
            linkedWorkspaceId: 'lw-1',
            itemId: 'r1',
            patch: {
              url: 'https://staging.example.test/r1',
              method: 'POST',
              headers: [{ key: 'X-Override', value: '1', enabled: true }],
            },
            updatedAt: T0,
          },
        },
        environmentVars: {
          'lw-1:dev:BASE_URL': {
            linkedWorkspaceId: 'lw-1',
            envName: 'dev',
            varKey: 'BASE_URL',
            value: 'https://my-fork.example.test',
            updatedAt: T0,
          },
          'lw-1:dev:OLD_VAR': {
            linkedWorkspaceId: 'lw-1',
            envName: 'dev',
            varKey: 'OLD_VAR',
            removed: true,
            updatedAt: T0,
          },
        },
      },
      releases: {
        self: null,
        perLink: {
          'lw-1': { versions: [], currentVersion: null },
        },
      },
    };
    const out = serializeWorkspaceForGit(populated);
    const parsed = JSON.parse(out) as WorkspaceSynced;
    expect(parsed.linkedWorkspaces).toEqual(populated.linkedWorkspaces);
    expect(parsed.linkedOverrides).toEqual(populated.linkedOverrides);
    expect(parsed.releases.perLink).toEqual(populated.releases.perLink);
    // Re-serialize the parsed doc — output is byte-identical.
    expect(serializeWorkspaceForGit(parsed)).toBe(out);
  });

  it('sorts nested object keys deeply', () => {
    const withRequest: WorkspaceSynced = {
      ...empty,
      collections: {
        ...empty.collections,
        requests: {
          'req-1': {
            id: 'req-1',
            name: 'Get user',
            folderId: null,
            method: 'GET',
            url: 'https://example.test/users/1',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: '2026-04-27T00:00:00.000Z',
            updatedAt: '2026-04-27T00:00:00.000Z',
          },
        },
      },
    };
    const out = serializeWorkspaceForGit(withRequest);
    // `body` sorts before `contextVars`, both before `createdAt`, etc.
    const bodyIdx = out.indexOf('"body"');
    const contextIdx = out.indexOf('"contextVars"');
    const createdAtIdx = out.indexOf('"createdAt"');
    expect(bodyIdx).toBeLessThan(contextIdx);
    expect(contextIdx).toBeLessThan(createdAtIdx);
  });
});
