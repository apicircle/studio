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

  it('resolves auth: inherit through the folder chain and blocks on an empty folder bearer', () => {
    const folders = {
      fParent: {
        id: 'fParent',
        name: 'Authed',
        parentId: null,
        auth: { type: 'bearer' as const, token: '' }, // empty — should block
      },
      fChild: { id: 'fChild', name: 'Users', parentId: 'fParent' },
    };
    const result = preSendValidation({
      request: baseReq({ folderId: 'fChild', auth: { type: 'inherit' } }),
      scope: emptyScope,
      folders,
    });
    const blocker = result.blockers.find((b) => b.kind === 'auth-fields-missing');
    expect(blocker).toBeDefined();
    expect(blocker?.message).toContain('Bearer token is empty');
    expect(blocker?.message).toContain('resolved from folder-level auth');
  });

  it('does NOT block when the inherited folder bearer has a valid token', () => {
    const folders = {
      fParent: {
        id: 'fParent',
        name: 'Authed',
        parentId: null,
        auth: { type: 'bearer' as const, token: 'VALID' },
      },
    };
    const result = preSendValidation({
      request: baseReq({ folderId: 'fParent', auth: { type: 'inherit' } }),
      scope: emptyScope,
      folders,
    });
    expect(result.blockers.some((b) => b.kind === 'auth-fields-missing')).toBe(false);
  });

  it('does NOT block when auth is inherit but no folders are provided (legacy callers)', () => {
    const result = preSendValidation({
      request: baseReq({ folderId: 'fChild', auth: { type: 'inherit' } }),
      scope: emptyScope,
      // folders omitted — declared auth used as-is; `inherit` has no fields to block on.
    });
    expect(result.blockers.some((b) => b.kind === 'auth-fields-missing')).toBe(false);
  });

  it('blocks on inherit → folder basic with missing password', () => {
    const folders = {
      fA: {
        id: 'fA',
        name: 'Authed',
        parentId: null,
        auth: { type: 'basic' as const, username: 'user', password: '' },
      },
    };
    const result = preSendValidation({
      request: baseReq({ folderId: 'fA', auth: { type: 'inherit' } }),
      scope: emptyScope,
      folders,
    });
    const blocker = result.blockers.find((b) => b.kind === 'auth-fields-missing');
    expect(blocker?.message).toContain('Basic auth requires');
    expect(blocker?.message).toContain('resolved from folder-level auth');
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

describe('preSendValidation — encryption-key references (Rule 5)', () => {
  // KEY is a vault slot that encrypts the TOKEN variable.
  const keyScope: ResolutionScope = {
    ...emptyScope,
    secrets: { KEY: 'slot-value' },
    encryptionKeys: { KEY: ['TOKEN'] },
  };
  const keyBlockers = (
    request: ApiRequest,
    folders?: Parameters<typeof preSendValidation>[0]['folders'],
  ) =>
    preSendValidation({ request, scope: keyScope, folders }).blockers.filter(
      (b) => b.kind === 'encryption-key-reference',
    );

  it('blocks a header that names an encryption key, with the message saying what to write', () => {
    const blockers = keyBlockers(
      baseReq({ headers: [{ key: 'Authorization', value: 'Bearer {{KEY}}', enabled: true }] }),
    );
    expect(blockers).toEqual([
      {
        kind: 'encryption-key-reference',
        message:
          '{{KEY}} is the encryption key of TOKEN, not a variable, so its value is never sent. ' +
          'Write {{TOKEN}} to send the variable.',
      },
    ]);
  });

  it('is not also reported as an unresolved variable', () => {
    const result = preSendValidation({
      request: baseReq({ headers: [{ key: 'X', value: '{{KEY}}', enabled: true }] }),
      scope: keyScope,
    });
    expect(result.warnings.some((w) => w.kind === 'unresolved-variable')).toBe(false);
  });

  it('finds the reference in the url, query, cookies, body and form rows — once', () => {
    const blockers = keyBlockers(
      baseReq({
        url: 'https://api.example.test/{{KEY}}',
        query: [{ key: 'k', value: '{{KEY}}', enabled: true }],
        cookies: [{ key: '{{KEY}}', value: 'v', enabled: true }],
        body: { type: 'json', content: '{"t":"{{KEY}}"}' },
      }),
    );
    expect(blockers).toHaveLength(1);

    for (const request of [
      baseReq({ url: 'https://api.example.test/?k={{KEY}}' }),
      baseReq({ query: [{ key: 'k', value: '{{KEY}}', enabled: true }] }),
      baseReq({ cookies: [{ key: 'c', value: '{{KEY}}', enabled: true }] }),
      baseReq({ body: { type: 'text', content: '{{KEY}}' } }),
      baseReq({
        body: {
          type: 'form-data',
          content: '',
          formRows: [{ kind: 'text', key: 'f', value: '{{KEY}}', enabled: true }],
        },
      }),
      baseReq({
        body: {
          type: 'form-data',
          content: '',
          formRows: [{ kind: 'file', key: '{{KEY}}', slotId: null, enabled: true }],
        },
      }),
    ]) {
      expect(keyBlockers(request)).toHaveLength(1);
    }
  });

  it('skips the URL parse when the URL holds an encryption key', () => {
    const result = preSendValidation({ request: baseReq({ url: '{{KEY}}/x' }), scope: keyScope });
    expect(result.blockers.map((b) => b.kind)).toEqual(['encryption-key-reference']);
  });

  it('finds the reference in an auth field, inherited ones included', () => {
    expect(keyBlockers(baseReq({ auth: { type: 'bearer', token: '{{KEY}}' } }))).toHaveLength(1);
    const folders = {
      f: {
        id: 'f',
        name: 'F',
        parentId: null,
        auth: { type: 'bearer', token: '{{KEY}}' } as RequestAuth,
      },
    } as unknown as Parameters<typeof preSendValidation>[0]['folders'];
    expect(
      keyBlockers(baseReq({ folderId: 'f', auth: { type: 'inherit' } as RequestAuth }), folders),
    ).toHaveLength(1);
  });

  it('ignores disabled rows', () => {
    expect(
      keyBlockers(baseReq({ headers: [{ key: 'X', value: '{{KEY}}', enabled: false }] })),
    ).toHaveLength(0);
  });

  it('does not block when an environment variable of that name wins', () => {
    const result = preSendValidation({
      request: baseReq({ headers: [{ key: 'X', value: '{{KEY}}', enabled: true }] }),
      scope: { ...keyScope, priorityEnvs: [{ KEY: 'env-value' }] },
    });
    expect(result.blockers).toHaveLength(0);
  });

  it('copes with a request that has no cookies and no auth', () => {
    // A document from disk can lack `auth` though the type requires it — the
    // validator's auth rule already guards for that, and so must Rule 5.
    const request = {
      ...baseReq({ headers: [{ key: 'X', value: '{{KEY}}', enabled: true }], cookies: undefined }),
      auth: undefined,
    } as unknown as ApiRequest;
    expect(keyBlockers(request)).toHaveLength(1);
  });
});
