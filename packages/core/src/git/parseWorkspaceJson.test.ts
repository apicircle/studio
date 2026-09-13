import { describe, expect, it } from 'vitest';
import { parseWorkspaceJson, RemoteWorkspaceParseError } from './parseWorkspaceJson';
import { attachmentPath } from './repoPaths';

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

describe('parseWorkspaceJson - path ids', () => {
  // Every id below becomes one segment of a repo path
  // (`.apicircle/workspace-<id>/attachments/<slotId>`), which the attachment
  // sync turns into a GitHub Contents API URL carrying the user's token.
  function docWith(mutate: (doc: Record<string, unknown>) => void): string {
    const doc = JSON.parse(minimumValidJson()) as Record<string, unknown>;
    mutate(doc);
    return JSON.stringify(doc);
  }

  function requestWithBody(body: Record<string, unknown>): Record<string, unknown> {
    return { r1: { id: 'r1', body: { type: 'none', content: '', ...body } } };
  }

  function codeOf(content: string): string | undefined {
    try {
      parseWorkspaceJson(content);
      return undefined;
    } catch (err) {
      return (err as RemoteWorkspaceParseError).code;
    }
  }

  const traversal = '../../../../../../victim/priv/contents/.env';

  it('accepts a document that carries every kind of slot reference with legitimate ids', () => {
    const content = docWith((doc) => {
      doc.workspaceId = '8f14e45f-ceea-467a-9575-6d8f0b2c1a3e';
      doc.collections = {
        tree: { id: 'root', type: 'root', children: [] },
        folders: {},
        requests: {
          form: {
            body: {
              type: 'form-data',
              content: '',
              formRows: [
                { kind: 'text', key: 'k', value: 'v', enabled: true },
                { kind: 'file', key: 'unset', slotId: null, enabled: true },
                { kind: 'file', key: 'f', slotId: 'with spaces', enabled: true },
              ],
            },
          },
          bin: { body: { type: 'binary', content: '', attachment: { slotId: 'slot-bin' } } },
          noBody: { id: 'noBody' },
        },
      };
      doc.linkedOverrides = {
        requests: {
          'link-1:r9': { patch: { body: { type: 'binary', attachment: { slotId: 'slot-o' } } } },
          'link-1:r8': { patch: { name: 'renamed only' } },
        },
      };
      doc.mockServers = {
        m1: {
          endpoints: [
            {
              defaultResponse: { body: { type: 'binary', attachment: { slotId: 'slot-m' } } },
              requestValidation: [{ failResponse: { body: { type: 'json' } } }],
              responseRules: [
                { response: { body: { type: 'binary', attachment: { slotId: 'r' } } } },
              ],
            },
            { defaultResponse: null },
          ],
        },
      };
      doc.globalAssets = { schemas: {}, graphql: {}, files: { f1: { slotId: 'slot-g' } } };
      doc.linkedWorkspaces = {
        l1: { id: 'l1', sourceWorkspaceId: 'imported-folder-0123456789abcdef' },
        l2: { id: 'l2' },
      };
    });
    expect(parseWorkspaceJson(content).workspaceId).toBe('8f14e45f-ceea-467a-9575-6d8f0b2c1a3e');
  });

  it('tolerates malformed containers around slot references (they hold no ids to check)', () => {
    const content = docWith((doc) => {
      doc.collections = {
        tree: {},
        folders: {},
        requests: { r1: 'not an object', r2: null, r3: ['not', 'a', 'request'] },
      };
      doc.mockServers = [];
      doc.globalAssets = 'nope';
      doc.linkedWorkspaces = null;
      doc.linkedOverrides = { requests: 5 };
    });
    expect(parseWorkspaceJson(content).workspaceId).toBe('ws-1');
  });

  it.each(['../x', '..%2f', 'a/../../b', '..\\x', '/abs', '..', 'C:x'])(
    'refuses a workspaceId of %j',
    (id) => {
      expect(codeOf(docWith((doc) => (doc.workspaceId = id)))).toBe('unsafe-id');
    },
  );

  // A slot id (and a linked source id) is scoped to the ONE attachment or link
  // it names, and is checked again where it becomes a path. Refusing the whole
  // document for one of them meant a workspace.json written by hand or by a tool
  // other than Studio could be neither pulled nor imported — with nothing to do
  // about it from inside the app — so these pin that the document loads and the
  // refusal happens at the path instead.
  const oddSlots = ['report 50%.csv', '2024-01-01T10:00:00Z', 'with spaces', traversal];

  it.each(oddSlots)('loads a document whose attachment slot is %j', (slotId) => {
    const content = docWith((doc) => {
      (doc.collections as Record<string, unknown>).requests = requestWithBody({
        type: 'binary',
        attachment: { slotId },
      });
    });
    const parsed = parseWorkspaceJson(content) as unknown as {
      collections: { requests: Record<string, { body: { attachment: { slotId: string } } }> };
    };
    // Left EXACTLY as written: a rewrite here would be pushed back to the branch
    // on the next push, quietly editing somebody else's document.
    expect(parsed.collections.requests.r1.body.attachment.slotId).toBe(slotId);
  });

  it('loads a document whose linked workspace names a free-form source id', () => {
    const content = docWith((doc) => {
      doc.linkedWorkspaces = { l1: { id: 'l1', sourceWorkspaceId: 'acme.api workspace' } };
    });
    const parsed = parseWorkspaceJson(content) as unknown as {
      linkedWorkspaces: Record<string, { sourceWorkspaceId: string }>;
    };
    expect(parsed.linkedWorkspaces.l1.sourceWorkspaceId).toBe('acme.api workspace');
  });

  it('leaves a traversal slot id for the path builder to refuse', () => {
    const content = docWith((doc) => {
      doc.globalAssets = { schemas: {}, graphql: {}, files: { f1: { slotId: traversal } } };
    });
    const parsed = parseWorkspaceJson(content);
    // The guarantee did not move out of the product, it moved to the place that
    // can act on it: nothing reaches a URL, and the refusal names the slot.
    expect(() => attachmentPath(parsed.workspaceId, traversal)).toThrow(
      /Unsafe attachment slot id/,
    );
  });

  it('refuses a non-string workspaceId', () => {
    expect(codeOf(docWith((doc) => (doc.workspaceId = 5)))).toBe('missing-workspace-id');
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
