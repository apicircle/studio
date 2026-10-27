import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';
import { deleteAttachment, getAttachment, putAttachment } from '../persistence/attachments';

// A spec split across files, through the real store thunks (fake-indexeddb):
// upload the spec, supply the files its `$ref`s point at, and everything
// derived from it — the reference list, the op count, linked mocks, the
// one-file spec — follows.

const store = () => useWorkspaceStore.getState();

const root = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Split', version: '1' },
  paths: {
    '/pets': { $ref: 'paths/pets.json' },
    '/health': { get: { responses: { '200': { description: 'ok' } } } },
  },
});
const pets = JSON.stringify({
  get: {
    responses: {
      '200': {
        description: 'ok',
        content: { 'application/json': { schema: { $ref: '../schemas/pet.json#/Pet' } } },
      },
    },
  },
});
const pet = JSON.stringify({
  Pet: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
});

/** A file as a folder pick hands it over: `webkitRelativePath` set. */
function picked(text: string, path: string): File {
  const file = new File([text], path.slice(path.lastIndexOf('/') + 1), {
    type: 'application/json',
  });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

const file = (text: string, name: string): File =>
  new File([text], name, { type: 'application/json' });

async function upload(f: File, init?: { quiet?: boolean }): Promise<string> {
  let id = '';
  await act(async () => {
    id = await store().addGlobalFileAsset(f, init);
  });
  return id;
}

const asset = (id: string) => store().synced?.globalAssets.files?.[id];

describe('a spec split across files', () => {
  beforeEach(async () => {
    await act(async () => {
      await store().hydrate();
    });
    for (const t of store().toasts) store().dismissToast(t.id);
  });

  it('lists the files the spec points at on upload, and says so', async () => {
    const id = await upload(file(root, 'openapi.json'));
    expect(asset(id)?.spec?.externalRefs).toEqual([{ target: 'paths/pets.json' }]);
    expect(asset(id)?.spec?.operationCount).toBe(1);
    expect(
      store().toasts.some((t) => t.title === "This spec points to 1 file Studio doesn't have"),
    ).toBe(true);
  });

  it('stays quiet when asked, and for a self-contained spec', async () => {
    const before = store().toasts.length;
    await upload(file(root, 'openapi.json'), { quiet: true });
    await upload(file(JSON.stringify({ openapi: '3.0.0', paths: {} }), 'solo.json'));
    expect(store().toasts.length).toBe(before);
  });

  it('maps a folder by path, round after round, and leaves out what matches nothing', async () => {
    const id = await upload(file(root, 'openapi.json'));
    let result = { mapped: [] as string[], unmatched: [] as string[] };
    await act(async () => {
      result = await store().uploadSpecExternalRefs(id, [
        picked(root, 'api/openapi.json'),
        picked(pet, 'api/schemas/pet.json'),
        picked(pets, 'api/paths/pets.json'),
        picked('# readme', 'api/README.md'),
      ]);
    });
    // pet.json is only reachable once pets.json is in: a second round maps it.
    expect(result).toEqual({
      mapped: ['paths/pets.json', 'schemas/pet.json'],
      unmatched: ['README.md'],
    });
    const spec = asset(id)?.spec;
    expect(spec?.operationCount).toBe(2);
    expect(spec?.warnings).toEqual([]);
    expect(spec?.externalRefs?.map((r) => r.target)).toEqual([
      'paths/pets.json',
      'schemas/pet.json',
    ]);
    expect(spec?.externalRefs?.every((r) => r.assetId && asset(r.assetId))).toBe(true);
    // The supplied files are used BY the spec.
    const petsId = spec?.externalRefs?.[0]?.assetId ?? '';
    expect(store().local?.assetUsageIndex?.[petsId]?.specRefs).toEqual([id]);
  });

  it('maps by unique name when files are picked without a folder', async () => {
    const id = await upload(file(root, 'openapi.json'));
    await act(async () => {
      await store().uploadSpecExternalRefs(id, [file(pets, 'pets.json')]);
    });
    expect(asset(id)?.spec?.externalRefs).toMatchObject([
      { target: 'paths/pets.json', assetId: expect.any(String) },
      { target: 'schemas/pet.json' },
    ]);
  });

  it('uploads one file for one named reference, and maps an existing file or unmaps it', async () => {
    const id = await upload(file(root, 'openapi.json'));
    await act(async () => {
      await store().uploadSpecExternalRefs(id, [file(pets, 'anything.json')], {
        target: 'paths/pets.json',
      });
    });
    const petId = await upload(file(pet, 'pet-schema.json'));
    await act(async () => {
      await store().mapSpecExternalRef(id, 'schemas/pet.json', petId);
    });
    expect(asset(id)?.spec?.externalRefs?.[1]).toEqual({
      target: 'schemas/pet.json',
      assetId: petId,
    });
    expect(asset(id)?.spec?.operationCount).toBe(2);

    await act(async () => {
      await store().mapSpecExternalRef(id, 'schemas/pet.json', null);
    });
    expect(asset(id)?.spec?.externalRefs?.[1]).toEqual({ target: 'schemas/pet.json' });
    // A target the spec does not reach is left alone.
    await act(async () => {
      await store().mapSpecExternalRef(id, 'nowhere.json', petId);
    });
    expect(asset(id)?.spec?.externalRefs?.map((r) => r.target)).toEqual([
      'paths/pets.json',
      'schemas/pet.json',
    ]);
  });

  it('does nothing for a non-spec asset or no files', async () => {
    const id = await upload(file(root, 'openapi.json'));
    const png = await upload(new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }));
    let out = { mapped: ['x'], unmatched: ['y'] };
    await act(async () => {
      out = await store().uploadSpecExternalRefs(png, [file(pets, 'pets.json')]);
    });
    expect(out).toEqual({ mapped: [], unmatched: [] });
    await act(async () => {
      out = await store().uploadSpecExternalRefs(id, []);
      await store().resolveSpecAsset(png);
      await store().resolveSpecAsset('no-such-asset');
    });
    expect(out).toEqual({ mapped: [], unmatched: [] });
    expect(await store().saveBundledSpecAsset('no-such-asset')).toBeNull();
  });

  it('keeps live mocks in step with the files supplied, and serves the full object', async () => {
    const id = await upload(file(root, 'openapi.json'));
    let mockId = '';
    await act(async () => {
      mockId = (
        await store().createMockServer({
          name: 'split',
          source: { kind: 'openapi-asset', assetId: id, format: 'json', mode: 'linked' },
        })
      ).id;
    });
    expect(store().synced?.mockServers[mockId]?.endpoints.map((e) => e.pathPattern)).toEqual([
      '/health',
    ]);
    await act(async () => {
      await store().uploadSpecExternalRefs(id, [
        picked(pets, 'api/paths/pets.json'),
        picked(pet, 'api/schemas/pet.json'),
      ]);
    });
    const endpoints = store().synced?.mockServers[mockId]?.endpoints ?? [];
    const petsEndpoint = endpoints.find((e) => e.pathPattern === '/pets');
    expect(JSON.parse(petsEndpoint?.defaultResponse.body.content ?? 'null')).toEqual({
      name: 'string',
    });
  });

  it('turns a reference missing again when its file is deleted, and re-reads new bytes', async () => {
    const id = await upload(file(root, 'openapi.json'));
    await act(async () => {
      await store().uploadSpecExternalRefs(id, [
        picked(pets, 'api/paths/pets.json'),
        picked(pet, 'api/schemas/pet.json'),
      ]);
    });
    const petsId = asset(id)?.spec?.externalRefs?.[0]?.assetId ?? '';

    // New bytes for a supplied file: the spec is read again with them.
    const twoOps = JSON.stringify({ ...JSON.parse(pets), post: { responses: { '201': {} } } });
    await act(async () => {
      await store().fillGlobalFileAssetBytes(petsId, file(twoOps, 'pets.json'));
    });
    expect(asset(id)?.spec?.operationCount).toBe(3);

    await act(async () => {
      await store().removeGlobalFileAsset(petsId);
    });
    // pets.json is missing again; pet.json is no longer reached at all.
    expect(asset(id)?.spec?.externalRefs).toEqual([{ target: 'paths/pets.json' }]);
    expect(asset(id)?.spec?.operationCount).toBe(1);
  });

  it('keeps the mappings when the spec itself is re-uploaded', async () => {
    const id = await upload(file(root, 'openapi.json'));
    await act(async () => {
      await store().uploadSpecExternalRefs(id, [
        picked(pets, 'api/paths/pets.json'),
        picked(pet, 'api/schemas/pet.json'),
      ]);
    });
    const revised = JSON.stringify({
      ...JSON.parse(root),
      info: { title: 'Split v2', version: '2' },
    });
    await act(async () => {
      await store().fillGlobalFileAssetBytes(id, file(revised, 'openapi.json'));
    });
    const spec = asset(id)?.spec;
    expect(spec?.title).toBe('Split v2');
    expect(spec?.operationCount).toBe(2);
    expect(spec?.externalRefs?.every((r) => r.assetId)).toBe(true);
  });

  it('counts several missing files in the upload toast', async () => {
    const two = JSON.stringify({
      openapi: '3.0.3',
      paths: { '/a': { $ref: 'a.json' }, '/b': { $ref: 'b.json' } },
    });
    await upload(file(two, 'two.json'));
    expect(
      store().toasts.some((t) => t.title === "This spec points to 2 files Studio doesn't have"),
    ).toBe(true);
  });

  it('leaves a spec alone when its bytes are not on this device', async () => {
    const id = await upload(file(root, 'openapi.json'));
    await deleteAttachment(asset(id)!.slotId);
    const before = asset(id)?.spec;
    await act(async () => {
      await store().resolveSpecAsset(id);
    });
    expect(asset(id)?.spec).toBe(before);
  });

  it('keeps what it knew when the bytes no longer read as a spec, and drops references they no longer make', async () => {
    const id = await upload(file(root, 'openapi.json'));
    const slotId = asset(id)!.slotId;
    // Bytes swapped behind the summary's back: not a spec at all…
    await putAttachment({
      ...(await getAttachment(slotId))!,
      bytes: new TextEncoder().encode('{"x":1}'),
    });
    await act(async () => {
      await store().resolveSpecAsset(id);
    });
    expect(asset(id)?.spec?.operationCount).toBe(1);
    expect(asset(id)?.spec?.externalRefs).toBeUndefined();
  });

  it('does nothing when the spec goes away while it is being read', async () => {
    const id = await upload(file(root, 'openapi.json'));
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = store().resolveSpecAsset(id);
      const synced = store().synced!;
      const { [id]: _gone, ...rest } = synced.globalAssets.files!;
      useWorkspaceStore.setState({
        synced: { ...synced, globalAssets: { ...synced.globalAssets, files: rest } },
      });
      await pending;
    });
    expect(asset(id)).toBeUndefined();
  });

  it('stops matching files when the spec is deleted part-way through', async () => {
    const id = await upload(file(root, 'openapi.json'));
    const realAdd = store().addGlobalFileAsset;
    useWorkspaceStore.setState({
      addGlobalFileAsset: async (f, init) => {
        const added = await realAdd(f, init);
        await store().removeGlobalFileAsset(id);
        return added;
      },
    });
    let out = { mapped: [] as string[], unmatched: [] as string[] };
    await act(async () => {
      out = await store().uploadSpecExternalRefs(id, [
        picked(pets, 'api/paths/pets.json'),
        picked(pet, 'api/schemas/pet.json'),
      ]);
    });
    useWorkspaceStore.setState({ addGlobalFileAsset: realAdd });
    expect(out).toEqual({ mapped: ['paths/pets.json'], unmatched: ['schemas/pet.json'] });
    expect(asset(id)).toBeUndefined();
  });

  it('reports on a live mock that went away while it was being refreshed', async () => {
    const id = await upload(file(root, 'openapi.json'));
    let mockId = '';
    await act(async () => {
      mockId = (
        await store().createMockServer({
          name: 'gone soon',
          source: { kind: 'openapi-asset', assetId: id, format: 'json', mode: 'linked' },
        })
      ).id;
    });
    const realRefresh = store().refreshMockServer;
    useWorkspaceStore.setState({
      refreshMockServer: async (mid) => {
        const out = await realRefresh(mid);
        store().removeMockServer(mid);
        return out;
      },
    });
    await act(async () => {
      await store().resolveSpecAsset(id);
    });
    useWorkspaceStore.setState({ refreshMockServer: realRefresh });
    expect(store().synced?.mockServers[mockId]).toBeUndefined();
    // Named by its id, with nothing served: the toast still says so.
    expect(store().toasts.some((t) => t.title.includes(mockId))).toBe(true);
  });

  it('saves the spec as one self-contained file once nothing is missing', async () => {
    const id = await upload(file(root, 'openapi.json'));
    expect(await store().saveBundledSpecAsset(id)).toBeNull();
    await act(async () => {
      await store().uploadSpecExternalRefs(id, [
        picked(pets, 'api/paths/pets.json'),
        picked(pet, 'api/schemas/pet.json'),
      ]);
    });
    let savedId: string | null = null;
    await act(async () => {
      savedId = await store().saveBundledSpecAsset(id);
    });
    const saved = asset(savedId ?? '');
    expect(saved?.name).toBe('openapi.json (one file)');
    expect(saved?.filename).toBe('openapi.bundled.json');
    expect(saved?.spec?.operationCount).toBe(2);
    expect(saved?.spec?.externalRefs).toBeUndefined();
    // The original is untouched, and saving again makes a second asset.
    expect(asset(id)?.spec?.externalRefs?.length).toBe(2);
    let again: string | null = null;
    await act(async () => {
      again = await store().saveBundledSpecAsset(id);
    });
    expect(again).not.toBe(savedId);
  });
});
