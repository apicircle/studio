import { describe, expect, it } from 'vitest';
import type {
  MockConditionClause,
  MockEndpoint,
  MockResponseConfig,
  MockResponseRule,
} from '@apicircle/shared';
import { evaluateResponseRules } from './evaluate';
import type { RequestContext } from './evaluate';

const baseCtx: RequestContext = {
  query: {},
  pathParams: {},
  headers: {},
  cookies: {},
  bodyText: '',
  bodyJson: undefined,
};

const defaultResponse: MockResponseConfig = {
  status: 200,
  headers: [],
  body: { type: 'json', content: '{"default":true}' },
};

function ruleResponse(content: string, status = 200): MockResponseConfig {
  return { status, headers: [], body: { type: 'json', content } };
}

function makeEndpoint(rules: MockResponseRule[]): MockEndpoint {
  return {
    id: 'e1',
    name: 'GET /x',
    method: 'GET',
    pathPattern: '/x',
    requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
    requestValidation: [],
    responseRules: rules,
    defaultResponse,
  };
}

function clause(
  scope: MockConditionClause['scope'],
  target: string,
  op: MockConditionClause['op'],
  value?: string,
): MockConditionClause {
  return { id: `c-${target}-${op}`, scope, target, op, value };
}

describe('evaluateResponseRules', () => {
  it('returns the default response when no rules match', () => {
    expect(evaluateResponseRules(makeEndpoint([]), baseCtx)).toBe(defaultResponse);
  });

  it('skips a clause-less rule (never fires) — returns the default, not the rule', () => {
    // The authoring layers (VS Code parser + MCP `.min(1)`) reject zero-clause
    // rules, but the engine must stay defensive for any old / imported data:
    // an empty `when` is a no-op, NOT a match-all that would shadow the default.
    const ep = makeEndpoint([
      { id: 'r1', name: 'empty', enabled: true, when: [], response: ruleResponse('{"rule":true}') },
    ]);
    expect(evaluateResponseRules(ep, baseCtx)).toBe(defaultResponse);
  });

  it('skips disabled rules', () => {
    const ep = makeEndpoint([
      {
        id: 'r1',
        name: 'disabled',
        enabled: false,
        when: [clause('query', 'q', 'present')],
        response: ruleResponse('{"r":1}'),
      },
    ]);
    const matchingCtx = { ...baseCtx, query: { q: '1' } };
    expect(evaluateResponseRules(ep, matchingCtx)).toBe(defaultResponse);
  });

  it('returns the first matching rule (top-down)', () => {
    const r1Resp = ruleResponse('{"r":1}');
    const r2Resp = ruleResponse('{"r":2}');
    const ep = makeEndpoint([
      {
        id: 'r1',
        name: 'first',
        enabled: true,
        when: [clause('query', 'q', 'equals', 'a')],
        response: r1Resp,
      },
      {
        id: 'r2',
        name: 'second',
        enabled: true,
        when: [clause('query', 'q', 'present')],
        response: r2Resp,
      },
    ]);
    expect(evaluateResponseRules(ep, { ...baseCtx, query: { q: 'a' } })).toBe(r1Resp);
    expect(evaluateResponseRules(ep, { ...baseCtx, query: { q: 'b' } })).toBe(r2Resp);
  });

  it('AND-combines all clauses on a rule', () => {
    const ep = makeEndpoint([
      {
        id: 'r1',
        name: 'both',
        enabled: true,
        when: [clause('query', 'a', 'present'), clause('query', 'b', 'present')],
        response: ruleResponse('{}'),
      },
    ]);
    expect(evaluateResponseRules(ep, { ...baseCtx, query: { a: '1' } })).toBe(defaultResponse);
    expect(evaluateResponseRules(ep, { ...baseCtx, query: { a: '1', b: '2' } })).not.toBe(
      defaultResponse,
    );
  });

  it('reads from headers (case-insensitive), cookies, and path params', () => {
    const ep = makeEndpoint([
      {
        id: 'r1',
        name: 'all',
        enabled: true,
        when: [
          clause('header', 'X-Trace', 'equals', 'abc'),
          clause('cookie', 'session', 'present'),
          clause('pathParam', 'id', 'equals', '42'),
        ],
        response: ruleResponse('{"hit":true}'),
      },
    ]);
    const ctx: RequestContext = {
      ...baseCtx,
      headers: { 'x-trace': 'abc' },
      cookies: { session: 'xx' },
      pathParams: { id: '42' },
    };
    expect(evaluateResponseRules(ep, ctx)).not.toBe(defaultResponse);
  });

  it('numeric ops compare numerically', () => {
    const ep = makeEndpoint([
      {
        id: 'r1',
        name: 'big',
        enabled: true,
        when: [clause('query', 'count', 'gt', '10')],
        response: ruleResponse('{"big":true}'),
      },
    ]);
    expect(evaluateResponseRules(ep, { ...baseCtx, query: { count: '15' } })).not.toBe(
      defaultResponse,
    );
    expect(evaluateResponseRules(ep, { ...baseCtx, query: { count: '5' } })).toBe(defaultResponse);
    // Non-numeric values fail numeric ops.
    expect(evaluateResponseRules(ep, { ...baseCtx, query: { count: 'lots' } })).toBe(
      defaultResponse,
    );
  });

  it('body-json-path resolves nested values', () => {
    const ep = makeEndpoint([
      {
        id: 'r1',
        name: 'nested',
        enabled: true,
        when: [clause('body-json-path', '$.user.role', 'equals', 'admin')],
        response: ruleResponse('{"admin":true}'),
      },
    ]);
    const ctx = { ...baseCtx, bodyJson: { user: { role: 'admin' } } };
    expect(evaluateResponseRules(ep, ctx)).not.toBe(defaultResponse);
  });

  it('absent-op fires when the value is missing or empty', () => {
    const ep = makeEndpoint([
      {
        id: 'r1',
        name: 'no-q',
        enabled: true,
        when: [clause('query', 'q', 'absent')],
        response: ruleResponse('{"hit":true}'),
      },
    ]);
    expect(evaluateResponseRules(ep, baseCtx)).not.toBe(defaultResponse);
    expect(evaluateResponseRules(ep, { ...baseCtx, query: { q: '' } })).not.toBe(defaultResponse);
    expect(evaluateResponseRules(ep, { ...baseCtx, query: { q: 'set' } })).toBe(defaultResponse);
  });
});
