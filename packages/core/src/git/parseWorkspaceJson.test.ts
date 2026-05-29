import { describe, expect, it } from 'vitest';
import { parseWorkspaceJson, RemoteWorkspaceParseError } from './parseWorkspaceJson';

// Minimum valid shape: `workspaceId` + `collections` + `environments`.
// Anything else is preserved verbatim.
function minimumValidJson(): string {
  return JSON.stringify({
    workspaceId: 'ws-1',
    collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
  });
}

describe('parseWorkspaceJson - happy path', () => {
  it('returns the parsed workspace for a minimum-valid doc', () => {
    const parsed = parseWorkspaceJson(minimumValidJson());
    expect(parsed.workspaceId).toBe('ws-1');
  });

  it('preserves unknown / extra fields (forward compat)', () => {
    const doc = JSON.parse(minimumValidJson()) as Record<string, unknown>;
    doc.futureFeature = { x: 1 };
    const parsed = parseWorkspaceJson(JSON.stringify(doc)) as unknown as {
      futureFeature?: { x: number };
    };
    expect(parsed.futureFeature?.x).toBe(1);
  });
});

describe('parseWorkspaceJson - prototype pollution defense', () => {
  it('strips top-level __proto__ keys', () => {
    const doc = JSON.parse(minimumValidJson()) as Record<string, unknown>;
    const polluted = { ...doc, __proto__: { polluted: true } };
    const parsed = parseWorkspaceJson(JSON.stringify(polluted)) as unknown as Record<
      string,
      unknown
    >;
    // The key is dropped - `polluted` is NOT on the parsed object or its prototype.
    expect((parsed as { polluted?: boolean }).polluted).toBeUndefined();
    expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('strips nested __proto__ keys', () => {
    const doc = JSON.parse(minimumValidJson()) as Record<string, unknown>;
    (doc.collections as { __proto__?: unknown }).__proto__ = { evil: true };
    const parsed = parseWorkspaceJson(JSON.stringify(doc));
    expect((parsed.collections as { evil?: boolean }).evil).toBeUndefined();
  });

  it('strips `constructor` and `prototype` keys', () => {
    const doc = JSON.parse(minimumValidJson()) as Record<string, unknown>;
    const polluted = {
      ...doc,
      constructor: { x: 1 },
      prototype: { y: 2 },
    };
    const parsed = parseWorkspaceJson(JSON.stringify(polluted)) as unknown as Record<
      string,
      unknown
    >;
    expect(parsed.constructor).toBe(Object); // back to the original prototype.constructor
    expect(parsed.prototype).toBeUndefined();
  });
});

describe('parseWorkspaceJson - shape enforcement', () => {
  it('throws RemoteWorkspaceParseError for invalid JSON', () => {
    expect.assertions(2);
    try {
      parseWorkspaceJson('not json {');
    } catch (err) {
      expect(err).toBeInstanceOf(RemoteWorkspaceParseError);
      expect((err as RemoteWorkspaceParseError).code).toBe('invalid-json');
    }
  });

  it('throws for a JSON value that is not an object (array)', () => {
    expect.assertions(1);
    try {
      parseWorkspaceJson('[1,2,3]');
    } catch (err) {
      expect((err as RemoteWorkspaceParseError).code).toBe('not-object');
    }
  });

  it('throws for a JSON value that is not an object (string)', () => {
    expect.assertions(1);
    try {
      parseWorkspaceJson('"hello"');
    } catch (err) {
      expect((err as RemoteWorkspaceParseError).code).toBe('not-object');
    }
  });

  it('throws when workspaceId is missing', () => {
    expect.assertions(1);
    try {
      parseWorkspaceJson('{"collections":{},"environments":{}}');
    } catch (err) {
      expect((err as RemoteWorkspaceParseError).code).toBe('missing-workspace-id');
    }
  });

  it('throws when workspaceId is not a string', () => {
    expect.assertions(1);
    try {
      parseWorkspaceJson('{"workspaceId":123,"collections":{},"environments":{}}');
    } catch (err) {
      expect((err as RemoteWorkspaceParseError).code).toBe('missing-workspace-id');
    }
  });

  it('throws when collections is missing', () => {
    expect.assertions(1);
    try {
      parseWorkspaceJson('{"workspaceId":"x","environments":{}}');
    } catch (err) {
      expect((err as RemoteWorkspaceParseError).code).toBe('missing-collections');
    }
  });

  it('throws when collections is an array (not an object)', () => {
    expect.assertions(1);
    try {
      parseWorkspaceJson('{"workspaceId":"x","collections":[],"environments":{}}');
    } catch (err) {
      expect((err as RemoteWorkspaceParseError).code).toBe('missing-collections');
    }
  });

  it('throws when environments is missing', () => {
    expect.assertions(1);
    try {
      parseWorkspaceJson('{"workspaceId":"x","collections":{}}');
    } catch (err) {
      expect((err as RemoteWorkspaceParseError).code).toBe('missing-environments');
    }
  });
});

describe('parseWorkspaceJson - size cap', () => {
  it('rejects input over 16 MiB without attempting to parse', () => {
    const giant = 'x'.repeat(16 * 1024 * 1024 + 1);
    expect.assertions(1);
    try {
      parseWorkspaceJson(giant);
    } catch (err) {
      expect((err as RemoteWorkspaceParseError).code).toBe('oversized');
    }
  });
});
