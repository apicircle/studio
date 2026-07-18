import { describe, expect, it } from 'vitest';
import { looksTextual, summarizeUploadedSpec } from './specUpload';

const NOW = '2026-07-11T00:00:00.000Z';
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const openapi = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0' },
  paths: { '/pets': { get: { responses: { '200': {} } } } },
});

describe('looksTextual', () => {
  it('accepts .json / .yaml / .yml filenames', () => {
    expect(looksTextual('spec.json', 'application/octet-stream')).toBe(true);
    expect(looksTextual('spec.yaml', '')).toBe(true);
    expect(looksTextual('spec.yml', '')).toBe(true);
  });

  it('accepts json/yaml/text MIME types', () => {
    expect(looksTextual('blob', 'application/json')).toBe(true);
    expect(looksTextual('blob', 'application/yaml')).toBe(true);
    expect(looksTextual('blob', 'text/plain')).toBe(true);
  });

  it('rejects binary uploads', () => {
    expect(looksTextual('logo.png', 'image/png')).toBe(false);
  });
});

describe('summarizeUploadedSpec', () => {
  it('returns undefined for a non-textual upload without decoding', async () => {
    const spec = await summarizeUploadedSpec(enc(openapi), 'logo.png', 'image/png', NOW);
    expect(spec).toBeUndefined();
  });

  it('derives SpecAssetMeta from an OpenAPI upload and stamps the injected parsedAt', async () => {
    const spec = await summarizeUploadedSpec(
      enc(openapi),
      'petstore.json',
      'application/json',
      NOW,
    );
    expect(spec).toMatchObject({
      dialect: 'openapi-3',
      format: 'json',
      title: 'Petstore',
      operationCount: 1,
      parsedAt: NOW,
    });
  });

  it('returns undefined for a textual file that is not a spec', async () => {
    const notSpec = enc(JSON.stringify({ hello: 'world' }));
    const spec = await summarizeUploadedSpec(notSpec, 'data.json', 'application/json', NOW);
    expect(spec).toBeUndefined();
  });
});
