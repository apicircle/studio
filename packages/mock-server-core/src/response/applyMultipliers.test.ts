import { describe, expect, it } from 'vitest';
import type { MockResponseConfig } from '@apicircle/shared';
import { applyMultipliers } from './applyMultipliers';
import type { RequestContext } from '../rules/evaluate';

const baseCtx: RequestContext = {
  query: {},
  pathParams: {},
  headers: {},
  cookies: {},
  bodyText: '',
  bodyJson: undefined,
};

function makeJsonResponse(
  content: unknown,
  multipliers: MockResponseConfig['multipliers'],
): MockResponseConfig {
  return {
    status: 200,
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: { type: 'json', content: JSON.stringify(content) },
    multipliers,
  };
}

describe('applyMultipliers', () => {
  it('repeats the array element at targetJsonPath using a query-source count', () => {
    const response = makeJsonResponse({ items: [{ id: 1, name: 'X' }] }, [
      {
        id: 'm1',
        source: { kind: 'query', key: 'pageSize' },
        targetJsonPath: '$.items',
        defaultCount: 2,
      },
    ]);
    const ctx = { ...baseCtx, query: { pageSize: '4' } };
    const result = applyMultipliers(response, ctx);
    if (result.body.type !== 'json') throw new Error('expected json body');
    const parsed = JSON.parse(result.body.content) as { items: unknown[] };
    expect(parsed.items).toHaveLength(4);
    expect(parsed.items[0]).toEqual({ id: 1, name: 'X' });
    // Each element is its own object — mutating one must not affect another.
    (parsed.items[1] as { id: number }).id = 99;
    expect((parsed.items[0] as { id: number }).id).toBe(1);
  });

  it('falls back to defaultCount when source is missing', () => {
    const response = makeJsonResponse({ items: [{ id: 1 }] }, [
      {
        id: 'm1',
        source: { kind: 'query', key: 'pageSize' },
        targetJsonPath: '$.items',
        defaultCount: 3,
      },
    ]);
    const result = applyMultipliers(response, baseCtx);
    if (result.body.type !== 'json') throw new Error('expected json body');
    const parsed = JSON.parse(result.body.content) as { items: unknown[] };
    expect(parsed.items).toHaveLength(3);
  });

  it('falls back to defaultCount when source is non-numeric', () => {
    const response = makeJsonResponse({ items: [{ id: 1 }] }, [
      {
        id: 'm1',
        source: { kind: 'query', key: 'pageSize' },
        targetJsonPath: '$.items',
        defaultCount: 2,
      },
    ]);
    const ctx = { ...baseCtx, query: { pageSize: 'banana' } };
    const result = applyMultipliers(response, ctx);
    if (result.body.type !== 'json') throw new Error('expected json body');
    const parsed = JSON.parse(result.body.content) as { items: unknown[] };
    expect(parsed.items).toHaveLength(2);
  });

  it('clamps the count to min/max', () => {
    const response = makeJsonResponse({ items: [{ id: 1 }] }, [
      {
        id: 'm1',
        source: { kind: 'query', key: 'pageSize' },
        targetJsonPath: '$.items',
        defaultCount: 3,
        min: 2,
        max: 5,
      },
    ]);
    const tooSmall = applyMultipliers(response, { ...baseCtx, query: { pageSize: '1' } });
    const tooLarge = applyMultipliers(response, { ...baseCtx, query: { pageSize: '99' } });
    if (tooSmall.body.type !== 'json' || tooLarge.body.type !== 'json') throw new Error();
    expect((JSON.parse(tooSmall.body.content) as { items: unknown[] }).items).toHaveLength(2);
    expect((JSON.parse(tooLarge.body.content) as { items: unknown[] }).items).toHaveLength(5);
  });

  it('reads from path params, headers, and request body json paths', () => {
    const response = makeJsonResponse({ items: [{ id: 1 }] }, [
      {
        id: 'm1',
        source: { kind: 'pathParam', key: 'count' },
        targetJsonPath: '$.items',
        defaultCount: 1,
      },
    ]);
    const fromPath = applyMultipliers(response, { ...baseCtx, pathParams: { count: '4' } });
    if (fromPath.body.type !== 'json') throw new Error();
    expect((JSON.parse(fromPath.body.content) as { items: unknown[] }).items).toHaveLength(4);

    const headerResponse = {
      ...response,
      multipliers: [
        { ...response.multipliers![0], source: { kind: 'header' as const, key: 'X-Page-Size' } },
      ],
    };
    const fromHeader = applyMultipliers(headerResponse, {
      ...baseCtx,
      headers: { 'x-page-size': '5' },
    });
    if (fromHeader.body.type !== 'json') throw new Error();
    expect((JSON.parse(fromHeader.body.content) as { items: unknown[] }).items).toHaveLength(5);

    const bodyResponse = {
      ...response,
      multipliers: [
        {
          ...response.multipliers![0],
          source: { kind: 'body-json-path' as const, key: '$.page.size' },
        },
      ],
    };
    const fromBody = applyMultipliers(bodyResponse, {
      ...baseCtx,
      bodyJson: { page: { size: 7 } },
    });
    if (fromBody.body.type !== 'json') throw new Error();
    expect((JSON.parse(fromBody.body.content) as { items: unknown[] }).items).toHaveLength(7);
  });

  it('returns the response unchanged when target is not an array', () => {
    const response = makeJsonResponse({ items: { not: 'an array' } }, [
      {
        id: 'm1',
        source: { kind: 'query', key: 'pageSize' },
        targetJsonPath: '$.items',
        defaultCount: 2,
      },
    ]);
    const result = applyMultipliers(response, { ...baseCtx, query: { pageSize: '5' } });
    expect(result).toBe(response);
  });

  it('returns the response unchanged when target array is empty', () => {
    const response = makeJsonResponse({ items: [] }, [
      {
        id: 'm1',
        source: { kind: 'query', key: 'pageSize' },
        targetJsonPath: '$.items',
        defaultCount: 2,
      },
    ]);
    const result = applyMultipliers(response, { ...baseCtx, query: { pageSize: '5' } });
    expect(result).toBe(response);
  });

  it('skips multipliers entirely on non-JSON bodies', () => {
    const response: MockResponseConfig = {
      status: 200,
      headers: [],
      body: { type: 'text', content: 'plain' },
      multipliers: [
        {
          id: 'm1',
          source: { kind: 'query', key: 'pageSize' },
          targetJsonPath: '$.items',
          defaultCount: 5,
        },
      ],
    };
    const result = applyMultipliers(response, { ...baseCtx, query: { pageSize: '9' } });
    expect(result).toBe(response);
  });

  it('returns the response unchanged when JSON body fails to parse', () => {
    const response: MockResponseConfig = {
      status: 200,
      headers: [],
      body: { type: 'json', content: '{not json' },
      multipliers: [
        {
          id: 'm1',
          source: { kind: 'query', key: 'pageSize' },
          targetJsonPath: '$.items',
          defaultCount: 2,
        },
      ],
    };
    const result = applyMultipliers(response, { ...baseCtx, query: { pageSize: '5' } });
    expect(result).toBe(response);
  });

  it('walks nested JSON paths', () => {
    const response = makeJsonResponse({ data: { page: { items: [{ id: 1 }] } } }, [
      {
        id: 'm1',
        source: { kind: 'query', key: 'pageSize' },
        targetJsonPath: '$.data.page.items',
        defaultCount: 1,
      },
    ]);
    const result = applyMultipliers(response, { ...baseCtx, query: { pageSize: '3' } });
    if (result.body.type !== 'json') throw new Error();
    const parsed = JSON.parse(result.body.content) as { data: { page: { items: unknown[] } } };
    expect(parsed.data.page.items).toHaveLength(3);
  });

  it('treats a count of zero as an empty array', () => {
    const response = makeJsonResponse({ items: [{ id: 1 }] }, [
      {
        id: 'm1',
        source: { kind: 'query', key: 'pageSize' },
        targetJsonPath: '$.items',
        defaultCount: 0,
      },
    ]);
    const result = applyMultipliers(response, baseCtx);
    if (result.body.type !== 'json') throw new Error();
    const parsed = JSON.parse(result.body.content) as { items: unknown[] };
    expect(parsed.items).toEqual([]);
  });

  // Path segments equal to `__proto__`, `constructor`, or `prototype` always
  // resolve through the prototype chain on plain objects and have no place
  // in a JSON multiplier. We treat any such path as a no-op rather than
  // letting it walk into Object.prototype.
  it('ignores multipliers whose path contains __proto__', () => {
    const response = makeJsonResponse({ items: [{ id: 1 }] }, [
      {
        id: 'm1',
        source: { kind: 'query', key: 'pageSize' },
        targetJsonPath: '$.__proto__.items',
        defaultCount: 5,
      },
    ]);
    const result = applyMultipliers(response, baseCtx);
    // Path is forbidden → no-op → response unchanged.
    expect(result).toBe(response);
  });

  it('ignores multipliers whose path contains constructor or prototype', () => {
    const response = makeJsonResponse({ items: [{ id: 1 }] }, [
      {
        id: 'm1',
        source: { kind: 'query', key: 'pageSize' },
        targetJsonPath: '$.constructor.prototype.items',
        defaultCount: 5,
      },
    ]);
    const result = applyMultipliers(response, baseCtx);
    expect(result).toBe(response);
  });

  it('ignores forbidden keys when expressed in bracket notation', () => {
    const response = makeJsonResponse({ items: [{ id: 1 }] }, [
      {
        id: 'm1',
        source: { kind: 'query', key: 'pageSize' },
        targetJsonPath: '$["__proto__"].items',
        defaultCount: 5,
      },
    ]);
    const result = applyMultipliers(response, baseCtx);
    expect(result).toBe(response);
  });
});
