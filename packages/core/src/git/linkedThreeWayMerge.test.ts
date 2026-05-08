import { describe, expect, it } from 'vitest';
import type {
  EnvironmentVariableOverride,
  LinkedSnapshot,
  Request as ApiRequest,
  RequestOverride,
} from '@apicircle/shared';
import { applyLinkedUpdate, previewLinkedUpdate } from './linkedThreeWayMerge';

const T0 = '2026-04-27T00:00:00.000Z';

function makeRequest(opts: Partial<ApiRequest> & { id: string }): ApiRequest {
  return {
    id: opts.id,
    name: opts.name ?? `Request ${opts.id}`,
    folderId: opts.folderId ?? null,
    method: opts.method ?? 'GET',
    url: opts.url ?? `https://example.test/${opts.id}`,
    headers: opts.headers ?? [],
    query: opts.query ?? [],
    body: opts.body ?? { type: 'none', content: '' },
    auth: opts.auth ?? { type: 'none' },
    contextVars: opts.contextVars ?? [],
    extractions: opts.extractions ?? [],
    assertions: opts.assertions ?? [],
    createdAt: opts.createdAt ?? T0,
    updatedAt: opts.updatedAt ?? T0,
  };
}

function snap(args: {
  requests?: ApiRequest[];
  envVars?: Array<{ key: string; value: string }>;
}): LinkedSnapshot {
  const requests = Object.fromEntries((args.requests ?? []).map((r) => [r.id, r]));
  return {
    workspaceName: 'Source',
    pulledAt: T0,
    ref: 'v1.0.0',
    collections: {
      tree: {
        id: 'r',
        type: 'root',
        children: (args.requests ?? []).map((r) => ({ kind: 'request' as const, id: r.id })),
      },
      requests,
      folders: {},
    },
    environments: args.envVars
      ? {
          items: {
            dev: {
              name: 'dev',
              variables: args.envVars.map((v) => ({ ...v, encrypted: false })),
            },
          },
          activeName: 'dev',
          priorityOrder: ['dev'],
        }
      : { items: {}, activeName: null, priorityOrder: [] },
  };
}

function override(id: string, patch: RequestOverride['patch']): RequestOverride {
  return {
    linkedWorkspaceId: 'lw-1',
    itemId: id,
    patch,
    updatedAt: T0,
  };
}

describe('previewLinkedUpdate — request classification', () => {
  it('unchanged: base equals target and no override', () => {
    const r = makeRequest({ id: 'r1' });
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '1.0.0',
      base: snap({ requests: [r] }),
      target: snap({ requests: [r] }),
      requestOverrides: [],
      envVarOverrides: [],
    });
    expect(preview.entries).toHaveLength(0);
    expect(preview.summary.unchanged).toBe(0); // unchanged entries are filtered out
  });

  it('source-only: target diverges from base, no override → fast-forward', () => {
    const r1 = makeRequest({ id: 'r1', url: 'https://old.example.test/r1' });
    const r2 = makeRequest({ id: 'r1', url: 'https://new.example.test/r1' });
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base: snap({ requests: [r1] }),
      target: snap({ requests: [r2] }),
      requestOverrides: [],
      envVarOverrides: [],
    });
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].status).toBe('source-only');
  });

  it('local-only: base equals target, override exists → keep mine', () => {
    const r = makeRequest({ id: 'r1' });
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base: snap({ requests: [r] }),
      target: snap({ requests: [r] }),
      requestOverrides: [override('r1', { url: 'https://staging.example.test/r1' })],
      envVarOverrides: [],
    });
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].status).toBe('local-only');
  });

  it('both-changed: base ≠ target AND override → user must pick', () => {
    const r1 = makeRequest({ id: 'r1', url: 'https://old.example.test/r1' });
    const r2 = makeRequest({ id: 'r1', url: 'https://new.example.test/r1' });
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base: snap({ requests: [r1] }),
      target: snap({ requests: [r2] }),
      requestOverrides: [override('r1', { headers: [{ key: 'X', value: '1', enabled: true }] })],
      envVarOverrides: [],
    });
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].status).toBe('both-changed');
  });

  it('new-in-source: target has a request the base lacks', () => {
    const r1 = makeRequest({ id: 'r1' });
    const r2 = makeRequest({ id: 'r2' });
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base: snap({ requests: [r1] }),
      target: snap({ requests: [r1, r2] }),
      requestOverrides: [],
      envVarOverrides: [],
    });
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].status).toBe('new-in-source');
    expect(preview.entries[0].key).toBe('r2');
  });

  it('removed-in-source: base has a request target lacks', () => {
    const r1 = makeRequest({ id: 'r1' });
    const r2 = makeRequest({ id: 'r2' });
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base: snap({ requests: [r1, r2] }),
      target: snap({ requests: [r1] }),
      requestOverrides: [],
      envVarOverrides: [],
    });
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].status).toBe('removed-in-source');
    expect(preview.entries[0].key).toBe('r2');
  });

  it('summary counts every status bucket', () => {
    const r1 = makeRequest({ id: 'r1' });
    const r2Old = makeRequest({ id: 'r2', url: 'https://old/r2' });
    const r2New = makeRequest({ id: 'r2', url: 'https://new/r2' });
    const r3 = makeRequest({ id: 'r3' });
    const r4 = makeRequest({ id: 'r4' });
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base: snap({ requests: [r1, r2Old, r3] }),
      target: snap({ requests: [r1, r2New, r4] }),
      requestOverrides: [override('r1', { headers: [{ key: 'X', value: '1', enabled: true }] })],
      envVarOverrides: [],
    });
    expect(preview.summary['local-only']).toBe(1); // r1
    expect(preview.summary['source-only']).toBe(1); // r2
    expect(preview.summary['removed-in-source']).toBe(1); // r3
    expect(preview.summary['new-in-source']).toBe(1); // r4
  });
});

describe('previewLinkedUpdate — env-var classification', () => {
  it('source-only when target adds a new env value', () => {
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base: snap({ envVars: [{ key: 'BASE', value: 'old' }] }),
      target: snap({ envVars: [{ key: 'BASE', value: 'new' }] }),
      requestOverrides: [],
      envVarOverrides: [],
    });
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].bucket).toBe('environment-var');
    expect(preview.entries[0].status).toBe('source-only');
  });

  it('local-only when consumer added a variable that doesn’t exist in source', () => {
    const ov: EnvironmentVariableOverride = {
      linkedWorkspaceId: 'lw-1',
      envName: 'dev',
      varKey: 'CONSUMER_FLAG',
      value: 'yes',
      updatedAt: T0,
    };
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base: snap({ envVars: [{ key: 'BASE', value: 'v' }] }),
      target: snap({ envVars: [{ key: 'BASE', value: 'v' }] }),
      requestOverrides: [],
      envVarOverrides: [ov],
    });
    const e = preview.entries.find((x) => x.key === 'dev:CONSUMER_FLAG');
    expect(e?.status).toBe('local-only');
  });

  it('both-changed when target shifts a value AND consumer overrode it', () => {
    const ov: EnvironmentVariableOverride = {
      linkedWorkspaceId: 'lw-1',
      envName: 'dev',
      varKey: 'BASE',
      value: 'consumer-side',
      updatedAt: T0,
    };
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base: snap({ envVars: [{ key: 'BASE', value: 'old' }] }),
      target: snap({ envVars: [{ key: 'BASE', value: 'new' }] }),
      requestOverrides: [],
      envVarOverrides: [ov],
    });
    const e = preview.entries.find((x) => x.key === 'dev:BASE');
    expect(e?.status).toBe('both-changed');
  });
});

describe('applyLinkedUpdate', () => {
  it('returns the target snapshot and drops overrides for accepted source entries', () => {
    const r1Old = makeRequest({ id: 'r1', url: 'https://old/r1' });
    const r1New = makeRequest({ id: 'r1', url: 'https://new/r1' });
    const ov = override('r1', { headers: [{ key: 'X', value: '1', enabled: true }] });
    const base = snap({ requests: [r1Old] });
    const target = snap({ requests: [r1New] });
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base,
      target,
      requestOverrides: [ov],
      envVarOverrides: [],
    });
    expect(preview.entries[0].status).toBe('both-changed');
    const result = applyLinkedUpdate({
      base,
      target,
      preview,
      resolutions: { 'request:r1': 'theirs' },
      requestOverrides: [ov],
      envVarOverrides: [],
    });
    expect(result.nextSnapshot).toBe(target);
    expect(result.nextRequestOverrides).toEqual([]);
    expect(result.log[0]).toMatchObject({ action: 'accept-source' });
  });

  it('keeps the override when user picks "mine" on a both-changed entry', () => {
    const r1Old = makeRequest({ id: 'r1', url: 'https://old/r1' });
    const r1New = makeRequest({ id: 'r1', url: 'https://new/r1' });
    const ov = override('r1', { url: 'https://my-fork/r1' });
    const base = snap({ requests: [r1Old] });
    const target = snap({ requests: [r1New] });
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base,
      target,
      requestOverrides: [ov],
      envVarOverrides: [],
    });
    const result = applyLinkedUpdate({
      base,
      target,
      preview,
      resolutions: { 'request:r1': 'mine' },
      requestOverrides: [ov],
      envVarOverrides: [],
    });
    expect(result.nextRequestOverrides).toHaveLength(1);
    expect(result.nextRequestOverrides[0].patch.url).toBe('https://my-fork/r1');
    expect(result.log[0]).toMatchObject({ action: 'keep-mine' });
  });

  it('throws when a both-changed entry has no resolution', () => {
    const r1Old = makeRequest({ id: 'r1', url: 'https://old/r1' });
    const r1New = makeRequest({ id: 'r1', url: 'https://new/r1' });
    const ov = override('r1', { url: 'https://my-fork/r1' });
    const base = snap({ requests: [r1Old] });
    const target = snap({ requests: [r1New] });
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base,
      target,
      requestOverrides: [ov],
      envVarOverrides: [],
    });
    expect(() =>
      applyLinkedUpdate({
        base,
        target,
        preview,
        resolutions: {},
        requestOverrides: [ov],
        envVarOverrides: [],
      }),
    ).toThrow(/unresolved both-changed/);
  });

  it('drops orphan overrides (removed-in-source defaults to "theirs")', () => {
    const r1Old = makeRequest({ id: 'r1' });
    const r2Old = makeRequest({ id: 'r2' });
    const ov = override('r2', { url: 'https://override/r2' });
    const base = snap({ requests: [r1Old, r2Old] });
    const target = snap({ requests: [r1Old] });
    const preview = previewLinkedUpdate({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      base,
      target,
      requestOverrides: [ov],
      envVarOverrides: [],
    });
    const result = applyLinkedUpdate({
      base,
      target,
      preview,
      resolutions: {}, // no explicit resolution → orphans default to drop
      requestOverrides: [ov],
      envVarOverrides: [],
    });
    expect(result.nextRequestOverrides).toEqual([]);
    expect(result.log[0]).toMatchObject({ action: 'drop-orphan' });
  });
});
