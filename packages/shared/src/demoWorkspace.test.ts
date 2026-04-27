import { describe, expect, it } from 'vitest';
import demoFixture from '../../../examples/demo-workspace/workspace.json' with { type: 'json' };
import type { WorkspaceSynced } from './index';

// Plan §10.1 demo workspace contract: the JSON fixture round-trips
// through the WorkspaceSynced type. If a schema rename lands without
// updating the fixture, this test fails CI before the demo workspace
// silently breaks for anyone trying the 60-second smoke test.

describe('Demo workspace fixture', () => {
  it('parses as a valid WorkspaceSynced', () => {
    // The TypeScript cast doubles as a structural check — `tsc` rejects
    // the import-with-cast if the JSON shape doesn't match the type.
    const synced: WorkspaceSynced = demoFixture as unknown as WorkspaceSynced;
    expect(synced.schemaVersion).toBe(1);
    expect(synced.workspaceName).toBe('Demo Workspace');
    expect(Object.keys(synced.collections.requests).length).toBeGreaterThanOrEqual(8);
  });

  it('covers every body type at least once', () => {
    const synced = demoFixture as unknown as WorkspaceSynced;
    const bodyTypes = new Set<string>();
    for (const r of Object.values(synced.collections.requests)) {
      bodyTypes.add(r.body.type);
    }
    // Plan §10.1: "One folder per body type". The 'none' body counts —
    // GET /health uses it. Form-data + binary are the two file-bearing
    // body types; both are present.
    for (const expected of [
      'none',
      'json',
      'text',
      'xml',
      'urlencoded',
      'form-data',
      'graphql',
      'binary',
    ]) {
      expect(bodyTypes.has(expected), `body type ${expected}`).toBe(true);
    }
  });

  it('covers all four assertion kinds across the request set', () => {
    const synced = demoFixture as unknown as WorkspaceSynced;
    const kinds = new Set<string>();
    for (const r of Object.values(synced.collections.requests)) {
      for (const a of r.assertions) kinds.add(a.kind);
    }
    expect(kinds).toEqual(new Set(['status', 'header', 'json-path', 'duration']));
  });

  it('declares the local environment with BASE_URL pointing at the mock server', () => {
    const synced = demoFixture as unknown as WorkspaceSynced;
    const env = synced.environments.items['local'];
    expect(env).toBeDefined();
    const baseUrl = env.variables.find((v) => v.key === 'BASE_URL');
    expect(baseUrl?.value).toBe('http://localhost:4040');
    expect(synced.environments.activeName).toBe('local');
  });

  it('ships an initial release in the ledger', () => {
    const synced = demoFixture as unknown as WorkspaceSynced;
    expect(synced.releases.self?.currentVersion).toBe('0.1.0');
    expect(synced.releases.self?.versions[0].version).toBe('0.1.0');
  });
});

describe('Linked pets-api fixture', () => {
  it('parses as a valid WorkspaceSynced with a multi-version ledger', async () => {
    const linked = (await import('../../../examples/linked-pets-api/workspace.json', {
      with: { type: 'json' },
    })) as unknown as { default: WorkspaceSynced };
    const synced = linked.default;
    expect(synced.workspaceName).toBe('Pets API');
    expect(synced.releases.self?.versions).toHaveLength(2);
    expect(synced.releases.self?.currentVersion).toBe('0.2.0');
  });
});
