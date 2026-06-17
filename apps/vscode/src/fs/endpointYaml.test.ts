import { describe, expect, it } from 'vitest';
import type { MockEndpoint } from '@apicircle/shared';
import {
  serializeEndpointToYaml,
  parseEndpointFromYaml,
  EndpointYamlParseError,
} from './endpointYaml';

function makeEndpoint(): MockEndpoint {
  return {
    id: 'ep-1',
    name: 'List pets',
    method: 'GET',
    pathPattern: '/pets',
    description: 'Returns a paginated list of pets.',
    requestSchema: {
      pathParams: [],
      queryParams: [{ id: 'q1', name: 'page', typeHint: 'integer', required: false }],
      headers: [],
      cookies: [],
    },
    requestValidation: [
      {
        id: 'v1',
        kind: 'header-required',
        target: 'Authorization',
        enabled: true,
        failResponse: {
          status: 401,
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
          body: { type: 'json', content: '{"error":"unauthorized"}' },
        },
      },
    ],
    responseRules: [
      {
        id: 'r1',
        name: 'Page 1 — small list',
        enabled: true,
        when: [
          {
            id: 'c1',
            scope: 'query',
            target: 'page',
            op: 'equals',
            value: '1',
          },
        ],
        response: {
          status: 200,
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
          body: { type: 'json', content: '{"items":[{"id":1}]}' },
        },
      },
    ],
    defaultResponse: {
      status: 200,
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: { type: 'json', content: '{"items":[]}' },
      multipliers: [
        {
          id: 'm1',
          name: 'Page size driven',
          source: { kind: 'query', key: 'pageSize' },
          targetJsonPath: '$.items',
          defaultCount: 10,
          min: 1,
          max: 100,
        },
      ],
    },
  };
}

describe('serializeEndpointToYaml', () => {
  it('renders every editable field including rules + multipliers', () => {
    const yaml = serializeEndpointToYaml(makeEndpoint());
    expect(yaml).toContain('id: ep-1');
    expect(yaml).toContain('method: GET');
    expect(yaml).toContain('pathPattern: /pets');
    expect(yaml).toContain('requestValidation:');
    expect(yaml).toContain('kind: header-required');
    expect(yaml).toContain('responseRules:');
    expect(yaml).toContain('name: Page 1 — small list');
    expect(yaml).toContain('defaultResponse:');
    expect(yaml).toContain('multipliers:');
    expect(yaml).toContain('targetJsonPath: $.items');
  });
});

describe('parseEndpointFromYaml', () => {
  it('round-trips a populated endpoint', () => {
    const yaml = serializeEndpointToYaml(makeEndpoint());
    const parsed = parseEndpointFromYaml(yaml);
    expect(parsed.endpoint.name).toBe('List pets');
    expect(parsed.endpoint.method).toBe('GET');
    expect(parsed.endpoint.requestValidation).toHaveLength(1);
    expect(parsed.endpoint.requestValidation[0].kind).toBe('header-required');
    expect(parsed.endpoint.requestValidation[0].failResponse.status).toBe(401);
    expect(parsed.endpoint.responseRules).toHaveLength(1);
    expect(parsed.endpoint.responseRules[0].name).toBe('Page 1 — small list');
    expect(parsed.endpoint.responseRules[0].when[0].value).toBe('1');
    expect(parsed.endpoint.defaultResponse.status).toBe(200);
    expect(parsed.endpoint.defaultResponse.multipliers).toHaveLength(1);
    expect(parsed.endpoint.defaultResponse.multipliers![0].targetJsonPath).toBe('$.items');
    expect(parsed.endpoint.defaultResponse.multipliers![0].min).toBe(1);
    expect(parsed.endpoint.defaultResponse.multipliers![0].max).toBe(100);
  });

  it('uppercases lowercase methods', () => {
    const yaml = 'name: x\nmethod: post\npathPattern: /x\n';
    const parsed = parseEndpointFromYaml(yaml);
    expect(parsed.endpoint.method).toBe('POST');
  });

  it('rejects an invalid method', () => {
    expect(() => parseEndpointFromYaml('name: x\nmethod: TRACE\npathPattern: /\n')).toThrow(
      EndpointYamlParseError,
    );
  });

  it('rejects missing required fields', () => {
    expect(() => parseEndpointFromYaml('name: x\nmethod: GET\n')).toThrow(EndpointYamlParseError);
  });

  it('rejects an unknown top-level key (renamed / mistyped field)', () => {
    // `defaultRespons` (typo) would otherwise silently drop the default
    // response on save — block it instead.
    expect(() =>
      parseEndpointFromYaml('name: x\nmethod: GET\npathPattern: /x\ndefaultRespons: {}\n'),
    ).toThrow(/Unknown field/);
  });

  it('rejects an unknown key inside a nested entry (param / clause / rule / header)', () => {
    const base = 'name: x\nmethod: GET\npathPattern: /pets/{petId}\n';
    // requestSchema param with a typo'd key
    expect(() =>
      parseEndpointFromYaml(
        base +
          'requestSchema:\n  pathParams:\n    - id: p1\n      naem: petId\n  queryParams: []\n  headers: []\n  cookies: []\n',
      ),
    ).toThrow(/unknown field/i);
    // response-rule clause with a typo'd key
    expect(() =>
      parseEndpointFromYaml(
        base +
          'responseRules:\n  - id: r1\n    name: R\n    enabled: true\n    when:\n      - id: c1\n        scope: query\n        targett: page\n        op: equals\n    response:\n      status: 200\n      headers: []\n      body:\n        type: none\n        content: ""\n',
      ),
    ).toThrow(/unknown field/i);
    // response header entry with a typo'd key
    expect(() =>
      parseEndpointFromYaml(
        base +
          'defaultResponse:\n  status: 200\n  headers:\n    - key: X\n      valuee: Y\n      enabled: true\n  body:\n    type: none\n    content: ""\n',
      ),
    ).toThrow(/unknown field/i);
  });

  it('rejects a structural type mismatch on a known section', () => {
    expect(() =>
      parseEndpointFromYaml('name: x\nmethod: GET\npathPattern: /x\nresponseRules: oops\n'),
    ).toThrow(/responseRules.*must be a list/);
    expect(() =>
      parseEndpointFromYaml('name: x\nmethod: GET\npathPattern: /x\nrequestSchema: oops\n'),
    ).toThrow(/requestSchema.*must be a mapping/);
  });

  it('rejects a response rule with no when condition (would shadow the default response)', () => {
    const yaml = [
      'name: x',
      'method: GET',
      'pathPattern: /x',
      'responseRules:',
      '  - id: r1',
      '    name: Always',
      '    enabled: true',
      '    when: []',
      '    response:',
      '      status: 418',
      '      headers: []',
      '      body:',
      '        type: none',
      '        content: ""',
    ].join('\n');
    expect(() => parseEndpointFromYaml(yaml)).toThrow(/at least one .*when.* condition/i);
  });

  it('warns + drops a validation rule with an unknown kind', () => {
    const yaml = [
      'name: x',
      'method: GET',
      'pathPattern: /x',
      'requestValidation:',
      '  - id: v1',
      '    kind: not-a-real-kind',
      '    target: x',
      '    enabled: true',
    ].join('\n');
    const parsed = parseEndpointFromYaml(yaml);
    expect(parsed.endpoint.requestValidation).toHaveLength(0);
    expect(parsed.warnings.some((w) => w.includes('not-a-real-kind'))).toBe(true);
  });

  it('defaults missing optional sections to empty arrays', () => {
    const yaml = 'name: x\nmethod: GET\npathPattern: /x\n';
    const parsed = parseEndpointFromYaml(yaml);
    expect(parsed.endpoint.requestValidation).toEqual([]);
    expect(parsed.endpoint.responseRules).toEqual([]);
    expect(parsed.endpoint.defaultResponse.status).toBe(200);
  });
});
