import { describe, expect, it } from 'vitest';
import type { SpecAssetMeta } from '@apicircle/shared';
import { bundleSpec } from './parsers/specBundle';
import { mergeExternalRefs, resolvedSpecMeta } from './specRefs';

describe('mergeExternalRefs', () => {
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

describe('resolvedSpecMeta', () => {
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
    post: { responses: { '201': { description: 'created' } } },
  });
  const meta: SpecAssetMeta = {
    dialect: 'openapi-3',
    format: 'json',
    title: 'Split',
    version: '1',
    operationCount: 1,
    parsedAt: '2026-01-01T00:00:00.000Z',
    warnings: ['an old warning'],
    externalRefs: [{ target: 'paths/pets.json', assetId: 'p' }],
  };

  it('counts the operations the supplied files hold, and lists the references they reveal', () => {
    const bundle = bundleSpec(
      { text: root, filename: 'openapi.json' },
      new Map([['paths/pets.json', pets]]),
    );
    const next = resolvedSpecMeta(
      meta,
      bundle,
      'openapi.json',
      new Set(['p']),
      '2026-02-02T00:00:00.000Z',
    );
    expect(next.operationCount).toBe(3);
    expect(next.parsedAt).toBe('2026-02-02T00:00:00.000Z');
    // pets.json is mapped and kept; the schema file it names joins, missing.
    expect(next.externalRefs).toEqual([
      { target: 'paths/pets.json', assetId: 'p' },
      { target: 'schemas/pet.json' },
    ]);
    // The summary of the bundle replaces the warnings the spec had: a file it was not
    // given is a reference still missing, not a warning.
    expect(next.warnings).toEqual([]);
    expect(next.title).toBe('Split');
  });

  it('turns a reference missing when its file asset is gone', () => {
    const bundle = bundleSpec({ text: root, filename: 'openapi.json' }, new Map());
    const next = resolvedSpecMeta(meta, bundle, 'openapi.json', new Set(), meta.parsedAt);
    expect(next.externalRefs).toEqual([{ target: 'paths/pets.json' }]);
    expect(next.operationCount).toBe(1);
  });

  it('drops the reference list once the spec reaches no other file', () => {
    const selfContained = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'One', version: '1' },
      paths: {},
    });
    const bundle = bundleSpec({ text: selfContained, filename: 'openapi.json' }, new Map());
    const next = resolvedSpecMeta(meta, bundle, 'openapi.json', new Set(['p']), meta.parsedAt);
    expect(next).not.toHaveProperty('externalRefs');
    expect(next.operationCount).toBe(0);
  });

  it('keeps the count and warnings it had when the bundle no longer reads as a spec', () => {
    const next = resolvedSpecMeta(
      meta,
      { text: 'not: [a spec', references: [], warnings: ['bundler said so'] },
      'openapi.json',
      new Set(),
      meta.parsedAt,
    );
    expect(next.operationCount).toBe(1);
    expect(next.warnings).toEqual(['an old warning', 'bundler said so']);
  });
});
