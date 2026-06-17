import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import type { LinkedWorkspace, ReleaseHistory } from '@apicircle/shared';
import { serializeLinkToYaml, parseLinkFromYaml, LinkYamlParseError } from './linkYaml';

function link(over: Partial<LinkedWorkspace> = {}): LinkedWorkspace {
  return {
    id: 'lw1',
    kind: 'public',
    name: 'Payments API',
    sourceWorkspaceId: 'src-ws-1',
    source: {
      provider: 'github',
      repoFullName: 'org/payments',
      branch: 'main',
      sessionMode: 'workspace',
    },
    scope: ['collections', 'environments'],
    pinnedVersion: '1.1.0',
    updatePolicy: 'manual',
    linkedAt: '2026-01-01T00:00:00.000Z',
    requiredSecretKeyIds: ['k1'],
    ...over,
  };
}

describe('serializeLinkToYaml', () => {
  it('emits editable + read-only fields and parses back to the editable patch', () => {
    const text = serializeLinkToYaml(link(), null);
    const parsed = YAML.parse(text) as Record<string, unknown>;
    expect(parsed.name).toBe('Payments API');
    expect(parsed.repoFullName).toBe('org/payments');
    expect(parsed.branch).toBe('main');
    expect(parsed.kind).toBe('public');
    expect(parsed.pinnedVersion).toBe('1.1.0');
    expect(parsed.scope).toEqual(['collections', 'environments']);
    expect(parsed.sessionMode).toBe('workspace');
    expect(parsed.requiredSecretKeyIds).toEqual(['k1']);

    const back = parseLinkFromYaml(text);
    expect(back.patch.name).toBe('Payments API');
    expect(back.patch.pinnedVersion).toBe('1.1.0');
    expect(back.patch.scope).toEqual(['collections', 'environments']);
    expect(back.patch.sessionMode).toBe('workspace');
    expect(back.patch.requiredSecretKeyIds).toEqual(['k1']);
  });

  it('includes the cached ledger in the header comment', () => {
    const ledger: ReleaseHistory = {
      currentVersion: '1.1.0',
      versions: [
        {
          version: '1.0.0',
          publishedAt: 't',
          notes: '',
          workspaceSnapshot: 'a'.repeat(64),
          deprecated: false,
          yanked: false,
        },
        {
          version: '1.1.0',
          publishedAt: 't',
          notes: '',
          workspaceSnapshot: 'b'.repeat(64),
          deprecated: false,
          yanked: false,
        },
      ],
    };
    const text = serializeLinkToYaml(link(), ledger);
    expect(text).toContain('Cached ledger');
    expect(text).toContain('1.0.0, 1.1.0');
  });

  it('serializes marketplace metadata only when present', () => {
    expect(serializeLinkToYaml(link({ marketplace: undefined }))).not.toContain('marketplace:');
    const withMp = serializeLinkToYaml(
      link({ marketplace: { listedAs: 'Pay', tags: ['payments'], summary: 'x' } }),
    );
    const parsed = YAML.parse(withMp) as { marketplace?: { listedAs: string } };
    expect(parsed.marketplace?.listedAs).toBe('Pay');
  });
});

describe('parseLinkFromYaml', () => {
  it('accepts null pinnedVersion (unpinned)', () => {
    const out = parseLinkFromYaml('name: x\npinnedVersion: null\n');
    expect(out.patch.pinnedVersion).toBeNull();
  });

  it('rejects unknown top-level keys', () => {
    expect(() => parseLinkFromYaml('name: x\nnope: 1\n')).toThrow(LinkYamlParseError);
  });

  it('rejects invalid scope values', () => {
    expect(() => parseLinkFromYaml('name: x\nscope:\n  - bogus\n')).toThrow(/scope/);
  });

  it('rejects a non-list scope', () => {
    expect(() => parseLinkFromYaml('name: x\nscope: collections\n')).toThrow(/must be a list/);
  });

  it('rejects an invalid sessionMode', () => {
    expect(() => parseLinkFromYaml('name: x\nsessionMode: nope\n')).toThrow(/sessionMode/);
  });

  it('dedupes scope + requiredSecretKeyIds', () => {
    const out = parseLinkFromYaml(
      'name: x\nscope:\n  - collections\n  - collections\nrequiredSecretKeyIds:\n  - k1\n  - k1\n',
    );
    expect(out.patch.scope).toEqual(['collections']);
    expect(out.patch.requiredSecretKeyIds).toEqual(['k1']);
  });

  it('parses marketplace = null as a clear signal', () => {
    const out = parseLinkFromYaml('name: x\nmarketplace: null\n');
    expect(out.patch.marketplace).toBeNull();
  });

  it('rejects an empty name', () => {
    expect(() => parseLinkFromYaml('name: "   "\n')).toThrow(/non-empty/);
  });

  it('rejects non-string description', () => {
    expect(() => parseLinkFromYaml('name: x\ndescription: 42\n')).toThrow(/string/);
  });

  it('accepts numeric pinnedVersion (coerces to string)', () => {
    const out = parseLinkFromYaml('name: x\npinnedVersion: 2\n');
    expect(out.patch.pinnedVersion).toBe('2');
  });

  it('rejects non-scalar pinnedVersion', () => {
    expect(() => parseLinkFromYaml('name: x\npinnedVersion:\n  - a\n')).toThrow(/pinnedVersion/);
  });

  it('rejects non-list requiredSecretKeyIds', () => {
    expect(() => parseLinkFromYaml('name: x\nrequiredSecretKeyIds: k1\n')).toThrow(
      /must be a list/,
    );
  });

  it('rejects non-string entries in requiredSecretKeyIds', () => {
    expect(() => parseLinkFromYaml('name: x\nrequiredSecretKeyIds:\n  - 42\n')).toThrow(
      /must be strings/,
    );
  });

  it('rejects non-mapping marketplace', () => {
    expect(() => parseLinkFromYaml('name: x\nmarketplace: "string"\n')).toThrow(
      /must be a mapping/,
    );
  });

  it('rejects unknown marketplace fields', () => {
    expect(() => parseLinkFromYaml('name: x\nmarketplace:\n  listedAs: y\n  bogus: z\n')).toThrow(
      /Unknown marketplace field/,
    );
  });

  it('rejects non-list marketplace.tags', () => {
    expect(() =>
      parseLinkFromYaml('name: x\nmarketplace:\n  listedAs: y\n  tags: notalist\n'),
    ).toThrow(/marketplace.*tags.*must be a list/);
  });

  it('filters non-string marketplace tags', () => {
    const out = parseLinkFromYaml(
      'name: x\nmarketplace:\n  listedAs: y\n  tags:\n    - good\n    - 42\n  summary: s\n',
    );
    expect(out.patch.marketplace?.tags).toEqual(['good']);
  });

  it('defaults marketplace listedAs/summary to empty string when missing', () => {
    const out = parseLinkFromYaml('name: x\nmarketplace:\n  tags: []\n');
    expect(out.patch.marketplace?.listedAs).toBe('');
    expect(out.patch.marketplace?.summary).toBe('');
  });

  it('throws LinkYamlParseError for non-YAML input', () => {
    expect(() => parseLinkFromYaml(':: !! bad')).toThrow(LinkYamlParseError);
  });

  it('throws LinkYamlParseError for array root', () => {
    expect(() => parseLinkFromYaml('- a\n- b\n')).toThrow(LinkYamlParseError);
  });

  it('accepts description: null as no-op (undefined patch)', () => {
    const out = parseLinkFromYaml('name: x\ndescription: null\n');
    expect(out.patch.description).toBeUndefined();
  });
});
