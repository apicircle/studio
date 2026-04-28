import { describe, expect, it } from 'vitest';
import type { Request as ApiRequest, WorkspaceSynced } from '@apicircle/shared';
import { collectAttachmentSlots } from './collectAttachments';

function workspace(requests: Record<string, ApiRequest>): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    workspaceName: 'W',
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: 't', updatedAt: 't', appVersion: '0.1.0' },
  };
}

function req(id: string, body: ApiRequest['body']): ApiRequest {
  return {
    id,
    name: id,
    folderId: null,
    method: 'POST',
    url: 'https://x',
    headers: [],
    query: [],
    body,
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: 't',
    updatedAt: 't',
  };
}

describe('collectAttachmentSlots', () => {
  it('returns [] for an empty workspace', () => {
    expect(collectAttachmentSlots(workspace({}))).toEqual([]);
  });

  it('collects a binary body attachment with metadata', () => {
    const r = req('a', {
      type: 'binary',
      content: '',
      attachment: {
        slotId: 'slot-1',
        sha256: 'aa',
        filename: 'pic.png',
        mimeType: 'image/png',
        size: 12,
      },
    });
    expect(collectAttachmentSlots(workspace({ a: r }))).toEqual([
      { slotId: 'slot-1', sha256: 'aa', filename: 'pic.png', mimeType: 'image/png', size: 12 },
    ]);
  });

  it('collects form-data file rows and ignores text rows / null slots', () => {
    const r = req('a', {
      type: 'form-data',
      content: '',
      formRows: [
        { kind: 'text', key: 'k', value: 'v', enabled: true },
        {
          kind: 'file',
          key: 'avatar',
          slotId: 'slot-A',
          sha256: 'bb',
          filename: 'a.png',
          enabled: true,
        },
        { kind: 'file', key: 'unset', slotId: null, enabled: true },
      ],
    });
    const slots = collectAttachmentSlots(workspace({ a: r }));
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ slotId: 'slot-A', sha256: 'bb', filename: 'a.png' });
  });

  it('deduplicates the same slotId across multiple requests', () => {
    const a = req('a', {
      type: 'binary',
      content: '',
      attachment: { slotId: 'shared', sha256: 'aa' },
    });
    const b = req('b', {
      type: 'form-data',
      content: '',
      formRows: [{ kind: 'file', key: 'f', slotId: 'shared', enabled: true }],
    });
    const slots = collectAttachmentSlots(workspace({ a, b }));
    expect(slots).toHaveLength(1);
    expect(slots[0].slotId).toBe('shared');
    // First occurrence wins — binary's metadata comes through.
    expect(slots[0].sha256).toBe('aa');
  });

  it('skips non-attachment body types', () => {
    const json = req('j', { type: 'json', content: '{"x":1}' });
    const text = req('t', { type: 'text', content: 'hi' });
    expect(collectAttachmentSlots(workspace({ j: json, t: text }))).toEqual([]);
  });
});
