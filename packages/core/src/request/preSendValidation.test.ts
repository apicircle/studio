import { describe, expect, it } from 'vitest';
import type { Request as ApiRequest, RequestAuth } from '@apicircle/shared';
import { preSendValidation } from './preSendValidation';
import type { ResolutionScope } from '../environment/variableResolver';

const emptyScope: ResolutionScope = {
  contextVars: {},
  activeEnv: {},
  priorityEnvs: [],
  secrets: {},
};

const baseReq = (overrides: Partial<ApiRequest> = {}): ApiRequest => ({
  id: 'r',
  name: 'r',
  folderId: null,
  method: 'GET',
  url: 'https://api.example.test/x',
  headers: [],
  query: [],
  pathParams: {},
  cookies: [],
  body: { type: 'none', content: '' },
  auth: { type: 'none' },
  contextVars: [],
  extractions: [],
  assertions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('preSendValidation', () => {
  it('clean request → no warnings, no blockers', () => {
    const result = preSendValidation({ request: baseReq(), scope: emptyScope });
    expect(result.warnings).toHaveLength(0);
    expect(result.blockers).toHaveLength(0);
  });

  it('empty URL is a blocker', () => {
    const result = preSendValidation({ request: baseReq({ url: '' }), scope: emptyScope });
    expect(result.blockers.some((b) => b.kind === 'empty-url')).toBe(true);
  });

  it('whitespace-only URL is a blocker', () => {
    const result = preSendValidation({ request: baseReq({ url: '   ' }), scope: emptyScope });
    expect(result.blockers.some((b) => b.kind === 'empty-url')).toBe(true);
  });

  it('malformed URL after resolution is a blocker', () => {
    const result = preSendValidation({
      request: baseReq({ url: 'htp://bad url with space' }),
      scope: emptyScope,
    });
    expect(result.blockers.some((b) => b.kind === 'unparseable-url')).toBe(true);
  });

  it('URL with unresolved {{var}} is a warning, NOT a blocker (Rule 1 owns that signal)', () => {
    const result = preSendValidation({
      request: baseReq({ url: '{{BASE}}/users' }),
      scope: emptyScope,
    });
    expect(result.blockers.some((b) => b.kind === 'unparseable-url')).toBe(false);
    expect(result.warnings.some((w) => w.kind === 'unresolved-variable')).toBe(true);
  });

  // Phase 6: warn when the URL contains `user:pass@host` credentials. They
  // are sent on the wire as Basic auth (Chromium converts userinfo into an
  // Authorization header) and persist into RequestRun.url history.
  it('warns when the URL contains user:pass@host credentials', () => {
    const result = preSendValidation({
      request: baseReq({ url: 'https://leaked:secret@api.example.test/x' }),
      scope: emptyScope,
    });
    expect(
      result.warnings.some(
        (w) =>
          w.kind === 'url-embedded-credentials' && /move them to the Auth tab/i.test(w.message),
      ),
    ).toBe(true);
  });

  it('does not warn for a URL with only a username (no password) — still valid auth but still suspect', () => {
    // We treat any embedded userinfo as suspect — username-only URLs are
    // rare but still send the username as Basic auth in some flows.
    const result = preSendValidation({
      request: baseReq({ url: 'https://justusername@api.example.test/x' }),
      scope: emptyScope,
    });
    expect(result.warnings.some((w) => w.kind === 'url-embedded-credentials')).toBe(true);
  });

  it('does not warn for a clean URL', () => {
    const result = preSendValidation({
      request: baseReq({ url: 'https://api.example.test/x' }),
      scope: emptyScope,
    });
    expect(result.warnings.some((w) => w.kind === 'url-embedded-credentials')).toBe(false);
  });

  it('flags unresolved {{var}} in the URL', () => {
    const result = preSendValidation({
      request: baseReq({ url: 'https://api.example.test/{{MISSING}}' }),
      scope: emptyScope,
    });
    expect(
      result.warnings.some(
        (w) => w.kind === 'unresolved-variable' && w.message.includes('MISSING'),
      ),
    ).toBe(true);
  });

  it('does NOT flag {{var}} when the active scope has the value', () => {
    const result = preSendValidation({
      request: baseReq({ url: 'https://api.example.test/{{KNOWN}}' }),
      scope: { ...emptyScope, contextVars: { KNOWN: 'val' } },
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('flags unbound path placeholders', () => {
    const result = preSendValidation({
      request: baseReq({ url: 'https://api.example.test/{userId}' }),
      scope: emptyScope,
    });
    expect(
      result.warnings.some((w) => w.kind === 'unbound-path-param' && w.message.includes('userId')),
    ).toBe(true);
  });

  it('does NOT flag path placeholders when pathParams provides the value', () => {
    const result = preSendValidation({
      request: baseReq({
        url: 'https://api.example.test/{userId}',
        pathParams: { userId: 'u-1' },
      }),
      scope: emptyScope,
    });
    expect(result.warnings.some((w) => w.kind === 'unbound-path-param')).toBe(false);
  });

  it('flags Content-Type mismatch with body type', () => {
    const result = preSendValidation({
      request: baseReq({
        body: { type: 'json', content: '{}' },
        headers: [{ key: 'Content-Type', value: 'text/plain', enabled: true }],
      }),
      scope: emptyScope,
    });
    expect(result.warnings.some((w) => w.kind === 'content-type-mismatch')).toBe(true);
  });

  it('does NOT flag Content-Type when it matches body type', () => {
    const result = preSendValidation({
      request: baseReq({
        body: { type: 'json', content: '{}' },
        headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      }),
      scope: emptyScope,
    });
    expect(result.warnings.some((w) => w.kind === 'content-type-mismatch')).toBe(false);
  });

  it('blocks send when Bearer auth has no token', () => {
    const auth: RequestAuth = { type: 'bearer', token: '' };
    const result = preSendValidation({
      request: baseReq({ auth }),
      scope: emptyScope,
    });
    expect(result.blockers.some((b) => b.kind === 'auth-fields-missing')).toBe(true);
  });

  it('blocks send when Basic auth is missing username', () => {
    const auth: RequestAuth = { type: 'basic', username: '', password: 's' };
    const result = preSendValidation({
      request: baseReq({ auth }),
      scope: emptyScope,
    });
    expect(result.blockers.some((b) => b.kind === 'auth-fields-missing')).toBe(true);
  });

  it('blocks send when API key has no value', () => {
    const auth: RequestAuth = { type: 'api-key', key: 'X-API-Key', value: '', addTo: 'header' };
    const result = preSendValidation({
      request: baseReq({ auth }),
      scope: emptyScope,
    });
    expect(result.blockers.some((b) => b.kind === 'auth-fields-missing')).toBe(true);
  });

  it('disabled rows are not validated for {{var}} references', () => {
    const result = preSendValidation({
      request: baseReq({
        headers: [{ key: 'X-Test', value: '{{MISSING}}', enabled: false }],
      }),
      scope: emptyScope,
    });
    expect(result.warnings.some((w) => w.kind === 'unresolved-variable')).toBe(false);
  });
});
