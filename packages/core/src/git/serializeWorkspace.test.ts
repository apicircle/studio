import { describe, expect, it } from 'vitest';
import type { WorkspaceSynced } from '@apicircle-v2/shared';
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
  releases: { self: null, perLink: {} },
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
        priorityOrder: ['prod', 'dev'],
      },
    };
    const out = serializeWorkspaceForGit(withOrder);
    // Priority list is an array — order is user-visible and must round-
    // trip verbatim. Pull the actual JSON-encoded array out of the text.
    const priorityMatch = /"priorityOrder": \[\s*([^\]]+)\s*\]/m.exec(out);
    expect(priorityMatch).not.toBeNull();
    expect(priorityMatch![1].trim()).toMatch(/"prod"[\s,]+"dev"/);
    // ...but the keys of `environments` and its sub-objects ARE sorted.
    expect(out.indexOf('"activeName"')).toBeLessThan(out.indexOf('"items"'));
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
            contextVars: [],
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
