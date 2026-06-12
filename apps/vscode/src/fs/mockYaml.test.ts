import { describe, it, expect } from 'vitest';
import { serializeMockToYaml, parseMockFromYaml, MockYamlParseError } from './mockYaml';
import type { MockServer } from '@apicircle/shared';

function makeMock(over: Partial<MockServer> = {}): MockServer {
  return {
    id: 'm1',
    name: 'Pet Store',
    source: { kind: 'openapi', spec: '{"openapi":"3.0.0"}', format: 'json' },
    endpoints: [
      {
        id: 'e1',
        method: 'GET',
        pathPattern: '/pets',
        name: 'list pets',
        description: 'List all pets',
        requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
        requestValidation: [],
        responseRules: [],
        defaultResponse: {
          status: 200,
          headers: [],
          body: { type: 'json', content: '[]' },
        },
      },
    ],
    defaultPort: 3000,
    cors: { enabled: false, origins: [] },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('serializeMockToYaml', () => {
  it('emits the header comment', () => {
    const out = serializeMockToYaml(makeMock());
    expect(out).toContain('API Circle Mock Server');
  });

  it('emits editable fields', () => {
    const out = serializeMockToYaml(makeMock());
    expect(out).toContain('name: Pet Store');
    expect(out).toContain('defaultPort: 3000');
    expect(out).toContain('enabled: false');
  });

  it('emits source kind + format for openapi', () => {
    const out = serializeMockToYaml(makeMock());
    expect(out).toContain('kind: openapi');
    expect(out).toContain('format: json');
  });

  it('emits endpoints as a read-only summary', () => {
    const out = serializeMockToYaml(makeMock());
    expect(out).toContain('method: GET');
    expect(out).toContain('pathPattern: /pets');
    expect(out).toContain('defaultStatus: 200');
  });

  it('emits null defaultPort when no port is configured', () => {
    const out = serializeMockToYaml(makeMock({ defaultPort: null }));
    expect(out).toContain('defaultPort: null');
  });

  it('omits empty origins from cors', () => {
    const out = serializeMockToYaml(makeMock());
    expect(out).not.toContain('origins:');
  });

  it('includes origins when present', () => {
    const out = serializeMockToYaml(makeMock({ cors: { enabled: true, origins: ['https://x'] } }));
    expect(out).toContain('origins:');
    expect(out).toContain('- https://x');
  });

  it('P3R4-G3: never serializes the spec content itself (secret-safety)', () => {
    // Spec contains what looks like a bearer token in a security example.
    // The serialized YAML must NOT contain it anywhere.
    const secretToken = 'BEARER_TOKEN_PLACEHOLDER_VALUE_1234567890abcdef';
    const specWithSecret = `{"openapi":"3.0.0","components":{"securitySchemes":{"bearer":{"example":"Bearer ${secretToken}"}}}}`;
    const out = serializeMockToYaml(
      makeMock({ source: { kind: 'openapi', spec: specWithSecret, format: 'json' } }),
    );
    expect(out).not.toContain(secretToken);
    expect(out).not.toContain('specPreview');
    expect(out).not.toContain('Bearer');
    // But the byte length IS reported so users see the spec is present.
    expect(out).toContain(`bytes: ${specWithSecret.length}`);
  });

  it('reports bytes for postman + insomnia sources too', () => {
    const postmanOut = serializeMockToYaml(
      makeMock({ source: { kind: 'postman', collection: '{"info":{"name":"x"}}' } }),
    );
    expect(postmanOut).toContain('kind: postman');
    expect(postmanOut).toContain('bytes:');
    expect(postmanOut).not.toContain('specPreview');

    const insomniaOut = serializeMockToYaml(
      makeMock({ source: { kind: 'insomnia', export: '{"_type":"export"}' } }),
    );
    expect(insomniaOut).toContain('kind: insomnia');
    expect(insomniaOut).toContain('bytes:');
  });

  it('handles manual source kind (no bytes, no preview)', () => {
    const out = serializeMockToYaml(makeMock({ source: { kind: 'manual', endpoints: [] } }));
    expect(out).toContain('kind: manual');
    expect(out).not.toContain('specPreview');
    expect(out).not.toContain('bytes:');
  });
});

describe('parseMockFromYaml', () => {
  it('throws MockYamlParseError for invalid YAML', () => {
    expect(() => parseMockFromYaml(':: !! not yaml')).toThrow(MockYamlParseError);
  });

  it('throws when root is not a mapping', () => {
    expect(() => parseMockFromYaml('- a\n- b')).toThrow(MockYamlParseError);
  });

  it('throws when name is missing', () => {
    expect(() => parseMockFromYaml('defaultPort: 3000')).toThrow(MockYamlParseError);
  });

  it('rejects an unknown top-level key (renamed / mistyped field)', () => {
    expect(() => parseMockFromYaml('name: x\ncores:\n  enabled: true\n')).toThrow(/Unknown field/);
  });

  it('rejects an unknown key inside cors', () => {
    expect(() => parseMockFromYaml('name: x\ncors:\n  enableed: true\n')).toThrow(/cors: unknown/);
  });

  it('parses name + defaultPort + cors', () => {
    const yaml =
      'name: Pet Store\ndefaultPort: 4000\ncors:\n  enabled: true\n  origins:\n    - https://example.com\n';
    const { patch } = parseMockFromYaml(yaml);
    expect(patch.name).toBe('Pet Store');
    expect(patch.defaultPort).toBe(4000);
    expect(patch.cors.enabled).toBe(true);
    expect(patch.cors.origins).toEqual(['https://example.com']);
  });

  it('accepts null defaultPort', () => {
    const yaml = 'name: x\ndefaultPort: null\n';
    expect(parseMockFromYaml(yaml).patch.defaultPort).toBeNull();
  });

  it('rejects defaultPort outside 1024-65535', () => {
    const yaml = 'name: x\ndefaultPort: 80\n';
    expect(() => parseMockFromYaml(yaml)).toThrow(/1024-65535/);
  });

  it('rejects non-integer defaultPort', () => {
    const yaml = 'name: x\ndefaultPort: "3000"\n';
    expect(() => parseMockFromYaml(yaml)).toThrow(/integer/);
  });

  it('warns when source field is present (it is read-only)', () => {
    const yaml = 'name: x\nsource:\n  kind: openapi\n';
    const { warnings } = parseMockFromYaml(yaml);
    expect(warnings.some((w) => w.includes('source'))).toBe(true);
  });

  it('warns when endpoints field is present (it is read-only)', () => {
    const yaml = 'name: x\nendpoints:\n  - id: e1\n';
    const { warnings } = parseMockFromYaml(yaml);
    expect(warnings.some((w) => w.includes('endpoints'))).toBe(true);
  });

  it('drops non-string entries from cors.origins with a warning', () => {
    const yaml = 'name: x\ncors:\n  enabled: true\n  origins:\n    - https://valid\n    - 42\n';
    const { patch, warnings } = parseMockFromYaml(yaml);
    expect(patch.cors.origins).toEqual(['https://valid']);
    expect(warnings.some((w) => w.includes('strings'))).toBe(true);
  });

  it('defaults cors to disabled when omitted', () => {
    const yaml = 'name: x\n';
    expect(parseMockFromYaml(yaml).patch.cors).toEqual({ enabled: false, origins: [] });
  });

  it('round-trips a manual mock through serialize → parse', () => {
    const original = makeMock({
      name: 'Round trip',
      defaultPort: 5050,
      cors: { enabled: true, origins: ['https://a', 'https://b'] },
      source: { kind: 'manual', endpoints: [] },
    });
    const yaml = serializeMockToYaml(original);
    const { patch } = parseMockFromYaml(yaml);
    expect(patch.name).toBe('Round trip');
    expect(patch.defaultPort).toBe(5050);
    expect(patch.cors).toEqual({ enabled: true, origins: ['https://a', 'https://b'] });
  });
});
