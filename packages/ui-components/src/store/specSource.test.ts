import { describe, expect, it } from 'vitest';
import type { GlobalFileAsset, SpecAssetMeta, WorkspaceSynced } from '@apicircle/shared';
import { putAttachment } from '../persistence/attachments';
import {
  bundledSpecFile,
  countMissingRefs,
  fileAssetIds,
  mappedAsset,
  matchUploadsToTargets,
  mergeExternalRefs,
  missingRefs,
  missingRefsLabel,
  pickedPath,
  readSpecAssetSource,
  specsMapping,
} from './specSource';

const meta = (o: Partial<SpecAssetMeta> = {}): SpecAssetMeta => ({
  dialect: 'openapi-3',
  format: 'json',
  operationCount: 1,
  parsedAt: 't',
  warnings: [],
  ...o,
});

const fileAsset = (id: string, o: Partial<GlobalFileAsset> = {}): GlobalFileAsset => ({
  id,
  name: id,
  slotId: `slot-${id}`,
  filename: `${id}.json`,
  size: 1,
  mimeType: 'application/json',
  createdAt: 't',
  updatedAt: 't',
  ...o,
});

const synced = (files: Record<string, GlobalFileAsset>): WorkspaceSynced => ({
  schemaVersion: 1,
  workspaceId: 'ws-1',
  collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
  environments: { items: {}, activeName: null, priorityOrder: [] },
  linkedWorkspaces: {},
  linkedOverrides: { requests: {}, environmentVars: {} },
  releases: { self: null, perLink: {} },
  globalAssets: { schemas: {}, graphql: {}, files },
  mockServers: {},
  meta: { createdAt: 't', updatedAt: 't', appVersion: '0.1.0' },
});

async function bytes(slotId: string, text: string, filename = 'x.json'): Promise<void> {
  await putAttachment({
    slotId,
    filename,
    mimeType: 'application/json',
    size: text.length,
    sha256: 'sha',
    savedAt: 't',
    bytes: new TextEncoder().encode(text),
  });
}

const named = (name: string, path?: string): File => {
  const f = new File(['{}'], name);
  if (path !== undefined) Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
};

describe('reading a spec asset with its referenced files', () => {
  const rootText = JSON.stringify({
    openapi: '3.0.3',
    components: { schemas: { Pet: { $ref: 'pet.yaml#/Pet' }, Tag: { $ref: 'tag.json' } } },
  });

  it('bundles the mapped files, and reports the unmapped and the unreadable as missing', async () => {
    await bytes('slot-spec', rootText, 'openapi.json');
    await bytes('slot-pet', 'Pet: { type: string }');
    const files = {
      spec: fileAsset('spec', {
        filename: 'openapi.json',
        spec: meta({
          externalRefs: [
            { target: 'pet.yaml', assetId: 'pet' },
            // mapped to an asset whose bytes are not on this device
            { target: 'tag.json', assetId: 'ghost' },
          ],
        }),
      }),
      pet: fileAsset('pet'),
      ghost: fileAsset('ghost'),
    };
    const out = await readSpecAssetSource(synced(files), 'spec');
    expect(out?.missing).toEqual(['tag.json']);
    expect(out?.format).toBe('json');
    expect(JSON.parse(out?.text ?? '{}')['x-apicircle-documents']).toEqual({
      'pet.yaml': { Pet: { type: 'string' } },
    });
  });

  it('gives back a self-contained spec byte for byte', async () => {
    await bytes('slot-solo', '{ "openapi": "3.0.0" }');
    const out = await readSpecAssetSource(synced({ solo: fileAsset('solo') }), 'solo');
    expect(out).toEqual({
      text: '{ "openapi": "3.0.0" }',
      format: 'json',
      references: [],
      missing: [],
      warnings: [],
    });
  });

  it('is null for an asset that is gone, or whose bytes are not on this device', async () => {
    expect(await readSpecAssetSource(synced({}), 'nope')).toBeNull();
    expect(await readSpecAssetSource(synced({ far: fileAsset('far') }), 'far')).toBeNull();
  });

  it('builds the one-file spec in its own format, only once nothing is missing', async () => {
    const yamlRoot =
      'openapi: 3.0.3\ncomponents:\n  schemas:\n    Pet: { $ref: "pet.yaml#/Pet" }\n';
    await bytes('slot-y', yamlRoot, 'api.yaml');
    await bytes('slot-p', 'Pet: { type: string }');
    const ready = {
      y: fileAsset('y', {
        filename: 'api.yaml',
        spec: meta({ format: 'yaml', externalRefs: [{ target: 'pet.yaml', assetId: 'p' }] }),
      }),
      p: fileAsset('p'),
    };
    const one = await bundledSpecFile(synced(ready), 'y');
    expect(one?.filename).toBe('api.bundled.yaml');
    expect(one?.mimeType).toBe('application/yaml');
    expect(one?.text).toContain('x-apicircle-documents');
    expect(one?.text).not.toContain('pet.yaml#');

    const notReady = {
      y: { ...ready.y, spec: meta({ format: 'yaml', externalRefs: [{ target: 'pet.yaml' }] }) },
    };
    expect(await bundledSpecFile(synced(notReady), 'y')).toBeNull();
    expect(await bundledSpecFile(synced({ p: fileAsset('p') }), 'p')).toBeNull();
    expect(await bundledSpecFile(synced({}), 'gone')).toBeNull();
    expect(await bundledSpecFile(null, 'y')).toBeNull();

    await bytes('slot-j', '{"openapi":"3.0.3"}', 'j.json');
    const json = await bundledSpecFile(synced({ j: fileAsset('j', { spec: meta() }) }), 'j');
    expect(json).toMatchObject({ filename: 'j.bundled.json', mimeType: 'application/json' });
  });
});

describe('spec reference bookkeeping', () => {
  const files = {
    a: fileAsset('a', {
      spec: meta({ externalRefs: [{ target: 'x.json', assetId: 'x' }, { target: 'y.json' }] }),
    }),
    b: fileAsset('b', { spec: meta({ externalRefs: [{ target: 'x.json', assetId: 'x' }] }) }),
    x: fileAsset('x'),
  };

  it('finds the mapped file, the specs mapping a file, and what is missing', () => {
    const s = synced(files);
    expect(mappedAsset(s, { target: 'x.json', assetId: 'x' })?.id).toBe('x');
    expect(mappedAsset(s, { target: 'x.json', assetId: 'gone' })).toBeUndefined();
    expect(mappedAsset(s, { target: 'x.json' })).toBeUndefined();
    expect(specsMapping(s, 'x')).toEqual(['a', 'b']);
    // A workspace that never had a file asset has no `files` map at all.
    const bare = { ...s, globalAssets: { schemas: {}, graphql: {} } } as WorkspaceSynced;
    expect(specsMapping(bare, 'x')).toEqual([]);
    expect(specsMapping(null, 'x')).toEqual([]);
    expect(fileAssetIds(s)).toEqual(new Set(['a', 'b', 'x']));
    expect(fileAssetIds(bare)).toEqual(new Set());
    expect(fileAssetIds(undefined)).toEqual(new Set());
    expect(missingRefs(s, files.a)).toEqual([{ target: 'y.json' }]);
    expect(missingRefs(s, files.x)).toEqual([]);
    expect(countMissingRefs(files.a, files)).toBe(1);
    expect(countMissingRefs(files.a, undefined)).toBe(2);
    expect(countMissingRefs(files.x, files)).toBe(0);
  });

  it('labels the missing count for a picker', () => {
    expect(missingRefsLabel(0)).toBe('');
    expect(missingRefsLabel(1)).toBe(' · 1 referenced file missing');
    expect(missingRefsLabel(3)).toBe(' · 3 referenced files missing');
  });

  it('carries the user’s mappings to the references still reached, dropping a deleted file’s', () => {
    expect(
      mergeExternalRefs(
        [
          { target: 'keep.json', assetId: 'k' },
          { target: 'deleted.json', assetId: 'd' },
          { target: 'gone.json', assetId: 'g' },
        ],
        [
          { target: 'new.json', supplied: false },
          { target: 'keep.json', supplied: true },
          { target: 'deleted.json', supplied: false },
        ],
        new Set(['k', 'g']),
      ),
    ).toEqual([
      { target: 'new.json' },
      { target: 'keep.json', assetId: 'k' },
      { target: 'deleted.json' },
    ]);
    expect(mergeExternalRefs(undefined, [{ target: 'a', supplied: false }], new Set())).toEqual([
      { target: 'a' },
    ]);
  });
});

describe('matching picked files to missing references', () => {
  it('reads a file’s path inside the picked folder', () => {
    expect(pickedPath(named('pet.json', 'api/schemas/pet.json'))).toBe('schemas/pet.json');
    expect(pickedPath(named('pet.json', ''))).toBe('pet.json');
    expect(pickedPath(named('pet.json'))).toBe('pet.json');
  });

  it('matches by path, a folder picked higher up, and a target that climbs above the spec', () => {
    const { matched, unmatched } = matchUploadsToTargets(
      [
        named('pet.json', 'api/schemas/pet.json'),
        named('errors.json', 'repo/specs/common/errors.json'),
        named('tag.json', 'api/up/tag.json'),
      ],
      ['schemas/pet.json', 'specs/common/errors.json', '../up/tag.json'],
      'openapi.json',
    );
    expect([...matched.entries()].map(([t, f]) => [t, f.name])).toEqual([
      ['schemas/pet.json', 'pet.json'],
      ['specs/common/errors.json', 'errors.json'],
      ['../up/tag.json', 'tag.json'],
    ]);
    expect(unmatched).toEqual([]);
  });

  it('falls back to a unique name, a URL’s last segment included', () => {
    const { matched } = matchUploadsToTargets(
      [named('common.yaml'), named('pet.json')],
      ['https://example.com/specs/common.yaml', 'models/pet.json'],
      'openapi.json',
    );
    expect([...matched.keys()]).toEqual([
      'https://example.com/specs/common.yaml',
      'models/pet.json',
    ]);
  });

  it('reads an unparseable URL-like target as a path', () => {
    const { matched } = matchUploadsToTargets([named('x.json')], ['http://[bad/x.json'], 'o.json');
    expect([...matched.keys()]).toEqual(['http://[bad/x.json']);
  });

  it('leaves out an ambiguous name, a file that matches nothing, and the spec itself', () => {
    const { matched, unmatched } = matchUploadsToTargets(
      [named('pet.json'), named('pet.json'), named('readme.md'), named('openapi.json')],
      ['a/pet.json', 'b/other.json'],
      'openapi.json',
    );
    expect(matched.size).toBe(0);
    expect(unmatched.map((f) => f.name)).toEqual(['pet.json', 'pet.json', 'readme.md']);

    const twoTargets = matchUploadsToTargets(
      [named('pet.json')],
      ['a/pet.json', 'b/pet.json'],
      'o.json',
    );
    expect(twoTargets.matched.size).toBe(0);
  });
});
