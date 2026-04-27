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
          source: { provider: 'github', repoFullName: 'me/pets', branch: 'main' },
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

  it('returns the same reference when nothing changed', () => {
    const { synced, local } = seed();
    const a = recomputeUsedIn(synced, local);
    const b = recomputeUsedIn(synced, a);
    expect(b).toBe(a);
  });
});
