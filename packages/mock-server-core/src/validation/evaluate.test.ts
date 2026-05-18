import { describe, expect, it } from 'vitest';
import type { MockEndpoint, MockValidationRule } from '@apicircle/shared';
import { evaluateValidation } from './evaluate';
import type { RequestContext } from '../rules/evaluate';

const baseCtx: RequestContext = {
  query: {},
  pathParams: {},
  headers: {},
  cookies: {},
  bodyText: '',
  bodyJson: undefined,
};

function makeEndpoint(rules: MockValidationRule[]): MockEndpoint {
  return {
    id: 'e1',
    name: 'GET /x',
    method: 'GET',
    pathPattern: '/x',
    requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
    requestValidation: rules,
    responseRules: [],
    defaultResponse: {
      status: 200,
      headers: [],
      body: { type: 'json', content: '{}' },
    },
  };
}

const failResponse = {
  status: 400,
  headers: [],
  body: { type: 'json' as const, content: '{"error":"x"}' },
};

describe('evaluateValidation', () => {
  it('returns null when there are no rules', () => {
    expect(evaluateValidation(makeEndpoint([]), baseCtx)).toBeNull();
  });

  it('skips disabled rules', () => {
    const ep = makeEndpoint([
      { id: 'r1', kind: 'header-required', target: 'authorization', enabled: false, failResponse },
    ]);
    expect(evaluateValidation(ep, baseCtx)).toBeNull();
  });

  it('returns the failResponse on the first failing rule', () => {
    const ep = makeEndpoint([
      { id: 'r1', kind: 'header-required', target: 'authorization', enabled: true, failResponse },
    ]);
    expect(evaluateValidation(ep, baseCtx)).toBe(failResponse);
  });

  it('passes when the required header is present', () => {
    const ep = makeEndpoint([
      { id: 'r1', kind: 'header-required', target: 'authorization', enabled: true, failResponse },
    ]);
    const ctx = { ...baseCtx, headers: { authorization: 'Bearer x' } };
    expect(evaluateValidation(ep, ctx)).toBeNull();
  });

  it('header-equals matches the expected literal', () => {
    const ep = makeEndpoint([
      {
        id: 'r1',
        kind: 'header-equals',
        target: 'X-Tenant',
        expected: 'acme',
        enabled: true,
        failResponse,
      },
    ]);
    const matching = { ...baseCtx, headers: { 'x-tenant': 'acme' } };
    const wrong = { ...baseCtx, headers: { 'x-tenant': 'other' } };
    expect(evaluateValidation(ep, matching)).toBeNull();
    expect(evaluateValidation(ep, wrong)).toBe(failResponse);
  });

  it('header-matches honors flagged regex syntax', () => {
    const ep = makeEndpoint([
      {
        id: 'r1',
        kind: 'header-matches',
        target: 'authorization',
        expected: '/^bearer .+/i',
        enabled: true,
        failResponse,
      },
    ]);
    expect(
      evaluateValidation(ep, { ...baseCtx, headers: { authorization: 'Bearer x' } }),
    ).toBeNull();
    expect(evaluateValidation(ep, { ...baseCtx, headers: { authorization: 'Basic x' } })).toBe(
      failResponse,
    );
  });

  it('query-required + query-equals work together', () => {
    const ep = makeEndpoint([
      { id: 'r1', kind: 'query-required', target: 'q', enabled: true, failResponse },
      { id: 'r2', kind: 'query-equals', target: 'q', expected: '42', enabled: true, failResponse },
    ]);
    expect(evaluateValidation(ep, baseCtx)).toBe(failResponse);
    expect(evaluateValidation(ep, { ...baseCtx, query: { q: '13' } })).toBe(failResponse);
    expect(evaluateValidation(ep, { ...baseCtx, query: { q: '42' } })).toBeNull();
  });

  it('body-required passes for non-empty parsed body', () => {
    const ep = makeEndpoint([
      { id: 'r1', kind: 'body-required', target: '', enabled: true, failResponse },
    ]);
    expect(evaluateValidation(ep, baseCtx)).toBe(failResponse);
    expect(evaluateValidation(ep, { ...baseCtx, bodyJson: {} })).toBe(failResponse);
    expect(evaluateValidation(ep, { ...baseCtx, bodyJson: { ok: true } })).toBeNull();
    expect(evaluateValidation(ep, { ...baseCtx, bodyText: 'plain' })).toBeNull();
  });

  it('content-type-equals strips parameters before comparing', () => {
    const ep = makeEndpoint([
      {
        id: 'r1',
        kind: 'content-type-equals',
        target: '',
        expected: 'application/json',
        enabled: true,
        failResponse,
      },
    ]);
    expect(
      evaluateValidation(ep, {
        ...baseCtx,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    ).toBeNull();
    expect(evaluateValidation(ep, { ...baseCtx, headers: { 'content-type': 'text/plain' } })).toBe(
      failResponse,
    );
  });

  it('cookie-required passes when the cookie is present', () => {
    const ep = makeEndpoint([
      { id: 'r1', kind: 'cookie-required', target: 'session', enabled: true, failResponse },
    ]);
    expect(evaluateValidation(ep, baseCtx)).toBe(failResponse);
    expect(evaluateValidation(ep, { ...baseCtx, cookies: { session: 'abc' } })).toBeNull();
  });
});
