import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '../persistence/workspaceStorage';
import { addRequest, updateRequest } from './editorActions';
import { addEnvironment, setVariables } from './envActions';
import { addSecretEntry } from './secretActions';
import { aggregateUsedIn, recomputeUsedIn } from './usedInAggregator';

function seed() {
  const fresh = createEmptyWorkspace();
  let local = fresh.local;
  local = addSecretEntry(local, { id: 's-token', label: 'TOKEN' });
  local = addSecretEntry(local, { id: 's-base', label: 'BASE_URL' });
  return { synced: fresh.synced, local };
}

describe('aggregateUsedIn', () => {
  it('returns an empty map when no secrets are defined', () => {
    const { synced, local } = createEmptyWorkspace();
    expect(aggregateUsedIn(synced, local)).toEqual({});
  });

  it('finds {{LABEL}} references in a request URL', () => {
    const { local } = seed();
    let { synced } = seed();
    const result = addRequest(synced, null);
    synced = updateRequest(result.synced, result.request.id, { url: '{{BASE_URL}}/users' });
    const usage = aggregateUsedIn(synced, local);
    expect(usage['s-base']).toEqual([
      { kind: 'request', id: result.request.id, label: 'New request' },
    ]);
  });

  it('finds references in headers (key + value), query, contextVars, and json/text bodies', () => {
    const { local } = seed();
    let { synced } = seed();
    const r = addRequest(synced, null);
    synced = updateRequest(r.synced, r.request.id, {
      headers: [{ key: 'Authorization', value: 'Bearer {{TOKEN}}', enabled: true }],
      query: [{ key: 'k', value: '{{BASE_URL}}', enabled: true }],
      contextVars: [{ key: 'X', value: '{{TOKEN}}' }],
      body: { type: 'json', content: '{"u":"{{BASE_URL}}/me"}' },
    });
    const usage = aggregateUsedIn(synced, local);
    expect(usage['s-token']).toEqual(
      expect.arrayContaining([{ kind: 'request', id: r.request.id, label: 'New request' }]),
    );
    expect(usage['s-base']).toEqual(
      expect.arrayContaining([{ kind: 'request', id: r.request.id, label: 'New request' }]),
    );
  });

  it('deduplicates per-request: multiple references in one request count once', () => {
    const { local } = seed();
    let { synced } = seed();
    const r = addRequest(synced, null);
    synced = updateRequest(r.synced, r.request.id, {
      url: '{{TOKEN}}/{{TOKEN}}/{{TOKEN}}',
    });
    const usage = aggregateUsedIn(synced, local);
    expect(usage['s-token']).toHaveLength(1);
  });

  it('finds references inside form-data text rows', () => {
    const { local } = seed();
    let { synced } = seed();
    const r = addRequest(synced, null);
    synced = updateRequest(r.synced, r.request.id, {
      body: {
        type: 'form-data',
        content: '',
        formRows: [{ kind: 'text', key: 'auth', value: 'Bearer {{TOKEN}}', enabled: true }],
      },
    });
    expect(aggregateUsedIn(synced, local)['s-token']).toHaveLength(1);
  });

  it('finds references in environment variable values (plaintext only)', () => {
    const { local } = seed();
    let { synced } = seed();
    synced = addEnvironment(synced, 'dev');
    synced = setVariables(synced, 'dev', [
      { key: 'AUTH', value: 'Bearer {{TOKEN}}', encrypted: false },
    ]);
    const usage = aggregateUsedIn(synced, local);
    expect(usage['s-token']).toEqual([
      { kind: 'environment-var', id: 'dev.AUTH', label: 'dev → AUTH' },
    ]);
  });

  it('does NOT scan encrypted env-var values (ciphertext is opaque)', () => {
    const { local } = seed();
    let { synced } = seed();
    synced = addEnvironment(synced, 'dev');
    // Pretend the ciphertext happens to contain the literal string {{TOKEN}}.
    synced = setVariables(synced, 'dev', [
      { key: 'AUTH', value: 'enc:v1:AAAA:{{TOKEN}}', encrypted: true },
    ]);
    expect(aggregateUsedIn(synced, local)['s-token'] ?? []).toEqual([]);
  });

  it('counts every variable a secret encrypts, with no {{LABEL}} anywhere', () => {
    const { local } = seed();
    let { synced } = seed();
    synced = addEnvironment(synced, 'staging');
    synced = addEnvironment(synced, 'prod');
    synced = setVariables(synced, 'staging', [
      { key: 'ADMIN_TOKEN', value: 'enc:v1:a', encrypted: true, secretKeyId: 's-token' },
      { key: '', value: 'enc:v1:b', encrypted: true, secretKeyId: 's-token' },
      // A stale binding on a plain variable encrypts nothing.
      { key: 'PLAIN', value: 'p', encrypted: false, secretKeyId: 's-token' },
    ]);
    synced = setVariables(synced, 'prod', [
      { key: 'ADMIN_TOKEN', value: 'enc:v1:c', encrypted: true, secretKeyId: 's-token' },
      // A slot this device has no vault entry for is not in the index.
      { key: 'OTHER', value: 'enc:v1:d', encrypted: true, secretKeyId: 's-not-indexed' },
    ]);
    expect(aggregateUsedIn(synced, local)).toEqual({
      's-token': [
        { kind: 'environment-var', id: 'staging.ADMIN_TOKEN', label: 'staging → ADMIN_TOKEN' },
        { kind: 'environment-var', id: 'staging.', label: 'staging → (unnamed)' },
        { kind: 'environment-var', id: 'prod.ADMIN_TOKEN', label: 'prod → ADMIN_TOKEN' },
      ],
    });
  });

  it("counts a linked workspace's variable an override binds, named by its link", () => {
    const { local: seeded } = seed();
    const { synced: base } = seed();
    const snapshot = {
      pulledAt: 't',
      ref: 'HEAD@main',
      collections: base.collections,
      environments: {
        items: {
          prod: { name: 'prod', variables: [{ key: 'TOKEN', value: 'p', encrypted: false }] },
        },
        activeName: null,
        priorityOrder: [],
      },
    };
    const bound = {
      envName: 'prod',
      varKey: 'TOKEN',
      value: 'enc:v1:x',
      encrypted: true,
      secretKeyId: 's-token',
      updatedAt: 't',
    };
    const synced = {
      ...base,
      linkedWorkspaces: {
        'lw-1': {
          id: 'lw-1',
          kind: 'public' as const,
          name: 'Pets API',
          sourceWorkspaceId: 'src-ws-pets',
          source: {
            provider: 'github' as const,
            repoFullName: 'me/pets',
            branch: 'main',
            sessionMode: 'workspace' as const,
          },
          scope: ['collections' as const],
          pinnedVersion: 'v1.0.0',
          updatePolicy: 'manual' as const,
          linkedAt: 't',
          requiredSecretKeyIds: [],
        },
      },
      linkedOverrides: {
        requests: {},
        environmentVars: {
          a: { ...bound, linkedWorkspaceId: 'lw-1' },
          // The link record is gone but its snapshot is still cached.
          b: { ...bound, linkedWorkspaceId: 'lw-gone' },
        },
      },
    };
    const local = {
      ...seeded,
      linkedCollections: { 'lw-1': snapshot, 'lw-gone': snapshot },
    };
    expect(aggregateUsedIn(synced, local)['s-token']).toEqual([
      { kind: 'environment-var', id: 'lw-1:prod.TOKEN', label: 'Pets API · prod → TOKEN' },
      { kind: 'environment-var', id: 'lw-gone:prod.TOKEN', label: 'lw-gone · prod → TOKEN' },
    ]);
  });

  it('records linked-workspace requiredSecretKeyIds as direct usages', () => {
    const { local } = seed();
    let { synced } = seed();
    synced = {
      ...synced,
      linkedWorkspaces: {
        'lw-1': {
          id: 'lw-1',
          kind: 'public',
          name: 'Pets API',
          sourceWorkspaceId: 'src-ws-pets',
          source: {
            provider: 'github',
            repoFullName: 'me/pets',
            branch: 'main',
            sessionMode: 'workspace' as const,
          },
          scope: ['collections'],
          pinnedVersion: 'v1.0.0',
          updatePolicy: 'manual',
          linkedAt: new Date().toISOString(),
          requiredSecretKeyIds: ['TOKEN'],
        },
      },
    };
    expect(aggregateUsedIn(synced, local)['s-token']).toEqual([
      { kind: 'linked-workspace-input', id: 'lw-1', label: 'Pets API' },
    ]);
  });

  it('ignores placeholders that do not match any secret label', () => {
    const { local } = seed();
    let { synced } = seed();
    const r = addRequest(synced, null);
    synced = updateRequest(r.synced, r.request.id, { url: '{{NOT_A_SECRET}}' });
    expect(aggregateUsedIn(synced, local)).toEqual({});
  });
});

describe('recomputeUsedIn', () => {
  it('resets stale usedIn[] arrays to [] when references disappear', () => {
    const { local } = seed();
    let { synced } = seed();
    const r = addRequest(synced, null);
    synced = updateRequest(r.synced, r.request.id, { url: '{{TOKEN}}' });
    const withUsage = recomputeUsedIn(synced, local);
    expect(withUsage.secretIndex.entries['s-token'].usedIn).toHaveLength(1);

    // Now strip the placeholder and recompute.
    synced = updateRequest(synced, r.request.id, { url: 'https://no-placeholder' });
    const cleared = recomputeUsedIn(synced, withUsage);
    expect(cleared.secretIndex.entries['s-token'].usedIn).toEqual([]);
  });

  it('drops a bound variable from usedIn once it no longer encrypts with the secret', () => {
    const { local } = seed();
    let { synced } = seed();
    synced = addEnvironment(synced, 'dev');
    synced = setVariables(synced, 'dev', [
      { key: 'AUTH', value: 'enc:v1:a', encrypted: true, secretKeyId: 's-token' },
    ]);
    const bound = recomputeUsedIn(synced, local);
    expect(bound.secretIndex.entries['s-token'].usedIn).toEqual([
      { kind: 'environment-var', id: 'dev.AUTH', label: 'dev → AUTH' },
    ]);

    synced = setVariables(synced, 'dev', [{ key: 'AUTH', value: 'a', encrypted: false }]);
    expect(recomputeUsedIn(synced, bound).secretIndex.entries['s-token'].usedIn).toEqual([]);
  });

  it('returns the same reference when nothing changed', () => {
    const { synced, local } = seed();
    const a = recomputeUsedIn(synced, local);
    const b = recomputeUsedIn(synced, a);
    expect(b).toBe(a);
  });
});
