import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { summarizeSpec } from './specSummary';

const openapiDoc = {
  openapi: '3.0.3',
  info: { title: 'Petstore', version: '1.2.0' },
  paths: {
    '/pets': {
      // `parameters` and `summary` are NOT operations and must not be counted.
      parameters: [],
      summary: 'pets collection',
      get: { responses: { '200': { description: 'ok' } } },
      post: { responses: { '201': { description: 'created' } } },
    },
    '/pets/{id}': {
      get: { responses: { '200': { description: 'ok' } } },
      delete: { responses: { '204': { description: 'gone' } } },
    },
  },
};

describe('summarizeSpec', () => {
  it('summarises an OpenAPI 3 JSON document', () => {
    const summary = summarizeSpec(JSON.stringify(openapiDoc), 'petstore.json');
    expect(summary).toEqual({
      dialect: 'openapi-3',
      format: 'json',
      title: 'Petstore',
      version: '1.2.0',
      operationCount: 4,
      warnings: [],
    });
  });

  it('summarises a Swagger 2.0 document', () => {
    const swagger = {
      swagger: '2.0',
      info: { title: 'Legacy', version: '0.9' },
      paths: { '/health': { get: { responses: { '200': {} } } } },
    };
    const summary = summarizeSpec(JSON.stringify(swagger), 'swagger.json');
    expect(summary?.dialect).toBe('swagger-2');
    expect(summary?.operationCount).toBe(1);
    expect(summary?.title).toBe('Legacy');
  });

  it('parses YAML by filename hint', () => {
    const summary = summarizeSpec(yaml.dump(openapiDoc), 'petstore.yaml');
    expect(summary?.format).toBe('yaml');
    expect(summary?.operationCount).toBe(4);
  });

  it('parses YAML by filename hint (.yml)', () => {
    const summary = summarizeSpec(yaml.dump(openapiDoc), 'petstore.yml');
    expect(summary?.format).toBe('yaml');
  });

  it('sniffs JSON from leading brace when no filename hint is given', () => {
    expect(summarizeSpec(JSON.stringify(openapiDoc))?.format).toBe('json');
  });

  it('sniffs YAML from content when no filename hint and no leading brace', () => {
    expect(summarizeSpec(yaml.dump(openapiDoc))?.format).toBe('yaml');
  });

  it('falls back to the other format when the hinted one fails', () => {
    // YAML content but a .json filename → JSON.parse fails, YAML succeeds.
    const summary = summarizeSpec(yaml.dump(openapiDoc), 'mislabelled.json');
    expect(summary?.format).toBe('yaml');
    expect(summary?.dialect).toBe('openapi-3');
  });

  it('omits title/version when info is absent', () => {
    const doc = { openapi: '3.1.0', paths: { '/x': { get: { responses: { '200': {} } } } } };
    const summary = summarizeSpec(JSON.stringify(doc));
    expect(summary?.title).toBeUndefined();
    expect(summary?.version).toBeUndefined();
  });

  it('warns when the spec declares no paths', () => {
    const doc = { openapi: '3.0.0', info: { title: 'Empty' } };
    const summary = summarizeSpec(JSON.stringify(doc));
    expect(summary?.operationCount).toBe(0);
    expect(summary?.warnings).toContain('The spec declares no paths.');
  });

  it('warns when paths exist but declare no operations', () => {
    const doc = { openapi: '3.0.0', paths: { '/x': { parameters: [] } } };
    const summary = summarizeSpec(JSON.stringify(doc));
    expect(summary?.operationCount).toBe(0);
    expect(summary?.warnings).toContain('The spec declares paths but no operations.');
  });

  it('skips non-object path items when counting', () => {
    const doc = {
      openapi: '3.0.0',
      paths: { '/ref': null, '/ok': { get: { responses: { '200': {} } } } },
    };
    expect(summarizeSpec(JSON.stringify(doc))?.operationCount).toBe(1);
  });

  it('returns null for a JSON document that is not a spec', () => {
    expect(summarizeSpec(JSON.stringify({ foo: 1, paths: {} }))).toBeNull();
  });

  it('returns null when openapi/swagger is present but not a string', () => {
    expect(summarizeSpec(JSON.stringify({ openapi: 3, paths: {} }))).toBeNull();
  });

  it('returns null for a non-object payload', () => {
    expect(summarizeSpec(JSON.stringify('just a string'))).toBeNull();
  });

  it('returns null for unparseable bytes', () => {
    expect(summarizeSpec('{ this is neither json nor: [yaml')).toBeNull();
  });
});
