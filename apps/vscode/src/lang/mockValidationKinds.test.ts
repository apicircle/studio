import { describe, expect, it } from 'vitest';
import type { MockRequestSchema, MockValidationRule } from '@apicircle/shared';
import {
  VALIDATION_KINDS,
  applyValidationKindChange,
  expectedValueCatalogue,
  schemaParamNames,
  validationKindDef,
  validationKindNeeds,
  validationTargetCandidates,
} from './mockValidationKinds';

function makeRule(overrides: Partial<MockValidationRule>): MockValidationRule {
  return {
    id: 'v1',
    kind: 'header-required',
    target: 'X-Api-Key',
    enabled: true,
    failResponse: { status: 400, headers: [], body: { type: 'json', content: '{}' } },
    ...overrides,
  };
}

const EMPTY_SCHEMA: MockRequestSchema = {
  pathParams: [],
  queryParams: [],
  headers: [],
  cookies: [],
};

describe('mockValidationKinds table', () => {
  it('covers all 9 MockValidationKind discriminants exactly once', () => {
    const kinds = VALIDATION_KINDS.map((k) => k.kind).sort();
    expect(kinds).toEqual(
      [
        'body-required',
        'content-type-equals',
        'cookie-required',
        'header-equals',
        'header-matches',
        'header-required',
        'query-equals',
        'query-matches',
        'query-required',
      ].sort(),
    );
    expect(new Set(kinds).size).toBe(VALIDATION_KINDS.length);
  });

  it('validationKindNeeds reflects the table; unknown kinds default to target-only', () => {
    expect(validationKindNeeds('header-required')).toEqual({ target: true, expected: false });
    expect(validationKindNeeds('header-equals')).toEqual({ target: true, expected: true });
    expect(validationKindNeeds('body-required')).toEqual({ target: false, expected: false });
    expect(validationKindNeeds('content-type-equals')).toEqual({ target: false, expected: true });
    expect(validationKindNeeds('totally-made-up')).toEqual({ target: true, expected: false });
  });

  it('validationKindDef resolves known kinds and undefined otherwise', () => {
    expect(validationKindDef('cookie-required')?.defaultTarget).toBe('session');
    expect(validationKindDef('nope')).toBeUndefined();
  });
});

describe('applyValidationKindChange', () => {
  it('seeds a placeholder target when moving into a kind that needs one and target is blank', () => {
    const next = applyValidationKindChange(makeRule({ target: '' }), 'query-required');
    expect(next.kind).toBe('query-required');
    expect(next.target).toBe('apiKey');
    expect(next.expected).toBeUndefined();
  });

  it('keeps an existing non-blank target across a same-family kind change', () => {
    const next = applyValidationKindChange(makeRule({ target: 'X-Tenant' }), 'header-equals');
    expect(next.target).toBe('X-Tenant');
    // header-equals compares a value → an empty expected row is seeded so the
    // ◆ Value lens renders.
    expect(next.expected).toBe('');
  });

  it('drops target + expected when moving into body-required', () => {
    const next = applyValidationKindChange(
      makeRule({ kind: 'header-equals', target: 'X-Api-Key', expected: 'abc' }),
      'body-required',
    );
    expect(next.target).toBe('');
    expect(next.expected).toBeUndefined();
  });

  it('drops the target but seeds expected for content-type-equals', () => {
    const next = applyValidationKindChange(
      makeRule({ kind: 'header-required', target: 'X-Api-Key' }),
      'content-type-equals',
    );
    expect(next.target).toBe('');
    expect(next.expected).toBe('');
  });

  it('preserves an existing expected value when staying in a value-comparing kind', () => {
    const next = applyValidationKindChange(
      makeRule({ kind: 'header-equals', target: 'Accept', expected: 'application/json' }),
      'header-matches',
    );
    expect(next.expected).toBe('application/json');
  });

  it('does not mutate the input rule', () => {
    const rule = makeRule({ target: 'X-Api-Key' });
    const snapshot = JSON.stringify(rule);
    applyValidationKindChange(rule, 'body-required');
    expect(JSON.stringify(rule)).toBe(snapshot);
  });
});

describe('schemaParamNames', () => {
  const schema: MockRequestSchema = {
    pathParams: [{ id: 'p1', name: 'id' }],
    queryParams: [
      { id: 'q1', name: 'page' },
      { id: 'q2', name: '' },
    ],
    headers: [{ id: 'h1', name: 'X-Tenant' }],
    cookies: [{ id: 'c1', name: 'session' }],
  };

  it('reads the header family for header kinds', () => {
    expect(schemaParamNames('header-equals', schema)).toEqual(['X-Tenant']);
  });

  it('reads the query family for query kinds and drops blank names', () => {
    expect(schemaParamNames('query-required', schema)).toEqual(['page']);
  });

  it('reads the cookie family for cookie kinds', () => {
    expect(schemaParamNames('cookie-required', schema)).toEqual(['session']);
  });

  it('returns [] for kinds with no target', () => {
    expect(schemaParamNames('body-required', schema)).toEqual([]);
    expect(schemaParamNames('content-type-equals', EMPTY_SCHEMA)).toEqual([]);
  });
});

describe('validationTargetCandidates', () => {
  const schema: MockRequestSchema = {
    pathParams: [],
    queryParams: [{ id: 'q1', name: 'page' }],
    headers: [{ id: 'h1', name: 'X-Tenant' }],
    cookies: [{ id: 'c1', name: 'session' }],
  };

  it('lists declared params first, then the global header catalogue, for header kinds', () => {
    const names = validationTargetCandidates('header-required', schema).map((c) => c.name);
    expect(names[0]).toBe('X-Tenant');
    expect(names[0 + 1]).toBeDefined();
    // The curated catalogue contributes well-known headers.
    expect(names).toContain('Authorization');
    expect(names).toContain('Content-Type');
    // Declared header isn't duplicated by the catalogue.
    expect(names.filter((n) => n.toLowerCase() === 'x-tenant')).toHaveLength(1);
  });

  it('lists only declared params for query / cookie kinds (no global catalogue)', () => {
    expect(validationTargetCandidates('query-required', schema).map((c) => c.name)).toEqual([
      'page',
    ]);
    expect(validationTargetCandidates('cookie-required', schema).map((c) => c.name)).toEqual([
      'session',
    ]);
  });

  it('returns [] for kinds with no target', () => {
    expect(validationTargetCandidates('body-required', schema)).toEqual([]);
    expect(validationTargetCandidates('content-type-equals', schema)).toEqual([]);
  });
});

describe('expectedValueCatalogue', () => {
  it('returns the Content-Type media-type catalogue for content-type-equals', () => {
    const values = expectedValueCatalogue('content-type-equals', '');
    expect(values).toContain('application/json');
    expect(values.length).toBeGreaterThan(1);
  });

  it("returns the picked header's known values for header-equals", () => {
    expect(expectedValueCatalogue('header-equals', 'Accept')).toContain('application/json');
    // A header with no curated values yields an empty list (free-text input).
    expect(expectedValueCatalogue('header-equals', 'X-Totally-Custom')).toEqual([]);
  });

  it('returns [] for regex / query / no-value kinds (free-text fallback)', () => {
    expect(expectedValueCatalogue('header-matches', 'Accept')).toEqual([]);
    expect(expectedValueCatalogue('query-equals', 'page')).toEqual([]);
    expect(expectedValueCatalogue('body-required', '')).toEqual([]);
  });
});
