import { describe, expect, it } from 'vitest';
import type { RequestAuth, WorkspaceSynced } from '@apicircle/shared';
import {
  APICIRCLE_FOLDER_EXPORT_FORMAT,
  collectFolderExport,
  type ApicircleFolderExportV1,
} from './folderExport';
import {
  collectFolderExportCredentials,
  redactFolderExportCredentials,
  type FolderExportCredential,
} from './folderExportCredentials';

const ISO = '2026-06-02T00:00:00.000Z';

function envelopeWithRootAuth(auth: RequestAuth | undefined): ApicircleFolderExportV1 {
  return {
    format: APICIRCLE_FOLDER_EXPORT_FORMAT,
    exportedAt: ISO,
    appVersion: '1',
    source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
    folder: { name: 'Root', auth, subfolders: [], requests: [] },
    dependencies: { schemas: [], graphql: [], files: [] },
  };
}

function envelopeWithRequestAuth(auth: RequestAuth, name = 'r'): ApicircleFolderExportV1 {
  return {
    format: APICIRCLE_FOLDER_EXPORT_FORMAT,
    exportedAt: ISO,
    appVersion: '1',
    source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
    folder: {
      name: 'Root',
      subfolders: [],
      requests: [
        {
          id: 'r-1',
          name,
          folderId: 'f-root',
          method: 'GET',
          url: 'https://x',
          headers: [],
          query: [],
          body: { type: 'none', content: '' },
          auth,
          contextVars: [],
          extractions: [],
          assertions: [],
          createdAt: ISO,
          updatedAt: ISO,
        },
      ],
    },
    dependencies: { schemas: [], graphql: [], files: [] },
  };
}

describe('collectFolderExportCredentials — per-variant detection', () => {
  it.each([
    [{ type: 'none' } as RequestAuth, 0],
    [{ type: 'inherit' } as RequestAuth, 0],
    [{ type: 'custom-header', key: 'X-Token', value: 'abc' } as RequestAuth, 0],
    [{ type: 'basic', username: 'u', password: 'p' } as RequestAuth, 1],
    [{ type: 'bearer', token: 'tk' } as RequestAuth, 1],
    [{ type: 'bearer', token: '' } as RequestAuth, 0],
    [{ type: 'api-key', key: 'X', value: 'v', addTo: 'header' } as RequestAuth, 1],
    [{ type: 'api-key', key: 'X', value: '', addTo: 'header' } as RequestAuth, 0],
    [{ type: 'digest', username: 'u', password: 'p' } as RequestAuth, 1],
    [{ type: 'ntlm', username: 'u', password: 'p', domain: '', workstation: '' } as RequestAuth, 1],
    [
      {
        type: 'hawk',
        hawkId: 'id',
        hawkKey: 'k',
        algorithm: 'sha256',
        ext: '',
      } as RequestAuth,
      1,
    ],
    [
      {
        type: 'hawk',
        hawkId: 'id',
        hawkKey: '',
        algorithm: 'sha256',
        ext: '',
      } as RequestAuth,
      0,
    ],
    [
      {
        type: 'jwt-bearer',
        algorithm: 'HS256',
        secretOrKey: 'sk',
        payload: '{}',
        jwtHeaders: '{}',
        token: 'tok',
      } as RequestAuth,
      2,
    ],
    [
      {
        type: 'jwt-bearer',
        algorithm: 'HS256',
        secretOrKey: '',
        payload: '{}',
        jwtHeaders: '{}',
        token: '',
      } as RequestAuth,
      0,
    ],
    [
      {
        type: 'aws-sigv4',
        accessKeyId: 'AKIA',
        secretAccessKey: 'sk',
        sessionToken: 'st',
        region: '',
        service: '',
        addTo: 'header',
      } as RequestAuth,
      2,
    ],
    [
      {
        type: 'aws-sigv4',
        accessKeyId: 'AKIA',
        secretAccessKey: '',
        sessionToken: '',
        region: '',
        service: '',
        addTo: 'header',
      } as RequestAuth,
      0,
    ],
    [
      {
        type: 'oauth2-client-credentials',
        tokenUrl: '',
        clientId: '',
        clientSecret: 'cs',
        scope: '',
        clientAuthMethod: 'body',
        accessToken: 'at',
        tokenType: 'Bearer',
        refreshToken: 'rt',
        expiresAt: 0,
        obtainedScope: '',
      } as RequestAuth,
      3,
    ],
    [
      {
        type: 'oauth2-auth-code',
        authUrl: '',
        tokenUrl: '',
        clientId: '',
        clientSecret: '',
        redirectUri: '',
        scope: '',
        state: '',
        accessToken: '',
        tokenType: 'Bearer',
        refreshToken: '',
        expiresAt: 0,
        obtainedScope: '',
      } as RequestAuth,
      0,
    ],
    [
      {
        type: 'oauth2-pkce',
        authUrl: '',
        tokenUrl: '',
        clientId: '',
        clientSecret: 'cs',
        redirectUri: '',
        scope: '',
        state: '',
        codeVerifier: '',
        codeChallengeMethod: 'S256',
        accessToken: 'at',
        tokenType: 'Bearer',
        refreshToken: '',
        expiresAt: 0,
        obtainedScope: '',
      } as RequestAuth,
      2,
    ],
    [
      {
        type: 'oauth2-password',
        tokenUrl: '',
        clientId: '',
        clientSecret: 'cs',
        username: 'u',
        password: 'p',
        scope: '',
        accessToken: 'at',
        tokenType: 'Bearer',
        refreshToken: 'rt',
        expiresAt: 0,
        obtainedScope: '',
      } as RequestAuth,
      4,
    ],
    [
      {
        type: 'oauth2-implicit',
        authUrl: '',
        clientId: '',
        redirectUri: '',
        scope: '',
        accessToken: 'at',
        tokenType: 'Bearer',
        expiresAt: 0,
        obtainedScope: '',
      } as RequestAuth,
      1,
    ],
    [
      {
        type: 'oauth2-device',
        deviceAuthUrl: '',
        tokenUrl: '',
        clientId: '',
        scope: '',
        deviceCode: '',
        userCode: '',
        verificationUri: '',
        accessToken: 'at',
        tokenType: 'Bearer',
        refreshToken: 'rt',
        expiresAt: 0,
        obtainedScope: '',
      } as RequestAuth,
      2,
    ],
  ])('detects credential fields for auth variant %#', (auth, expectedCount) => {
    const env = envelopeWithRequestAuth(auth as RequestAuth);
    const creds = collectFolderExportCredentials(env);
    expect(creds).toHaveLength(expectedCount);
  });

  it('emits stable ids using `<scope>:<ownerId>.<authType>.<field>`', () => {
    const env = envelopeWithRequestAuth({ type: 'bearer', token: 'tk' });
    const [cred] = collectFolderExportCredentials(env);
    expect(cred.id).toBe('request:r-1.bearer.token');
    expect(cred.scope).toBe('request');
    expect(cred.ownerId).toBe('r-1');
    expect(cred.ownerName).toBe('r');
  });

  it('detects credentials on root-folder auth', () => {
    const env = envelopeWithRootAuth({ type: 'bearer', token: 'tk' });
    const creds = collectFolderExportCredentials(env);
    expect(creds).toHaveLength(1);
    expect(creds[0].scope).toBe('root-folder');
    expect(creds[0].ownerId).toBe('f-root');
    expect(creds[0].id).toBe('folder:f-root.bearer.token');
  });

  it('detects credentials on a subfolder auth', () => {
    const env: ApicircleFolderExportV1 = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        subfolders: [
          {
            id: 'f-child',
            name: 'Child',
            parentId: 'f-root',
            auth: { type: 'basic', username: 'u', password: 'p' },
          },
        ],
        requests: [],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const creds = collectFolderExportCredentials(env);
    expect(creds).toHaveLength(1);
    expect(creds[0].scope).toBe('subfolder');
    expect(creds[0].id).toBe('folder:f-child.basic.password');
  });

  it('skips subfolders that have no auth', () => {
    const env: ApicircleFolderExportV1 = {
      ...envelopeWithRootAuth(undefined),
      folder: {
        name: 'Root',
        subfolders: [{ id: 'f-child', name: 'Child', parentId: 'f-root' }],
        requests: [],
      },
    };
    expect(collectFolderExportCredentials(env)).toEqual([]);
  });

  it('orders credentials by scope, then owner name, then field', () => {
    const env: ApicircleFolderExportV1 = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        auth: { type: 'bearer', token: 'tk' },
        subfolders: [
          {
            id: 'f-b',
            name: 'Beta',
            parentId: 'f-root',
            auth: { type: 'basic', username: 'u', password: 'p' },
          },
          {
            id: 'f-a',
            name: 'Alpha',
            parentId: 'f-root',
            auth: { type: 'bearer', token: 'tk2' },
          },
        ],
        requests: [
          {
            id: 'r-2',
            name: 'Z request',
            folderId: 'f-root',
            method: 'GET',
            url: '',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'bearer', token: 't' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: ISO,
            updatedAt: ISO,
          },
          {
            id: 'r-1',
            name: 'A request',
            folderId: 'f-root',
            method: 'GET',
            url: '',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'bearer', token: 't' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const creds = collectFolderExportCredentials(env);
    expect(creds.map((c) => c.id)).toEqual([
      'folder:f-root.bearer.token', // root folder
      'folder:f-a.bearer.token', // subfolder Alpha
      'folder:f-b.basic.password', // subfolder Beta
      'request:r-1.bearer.token', // request "A request"
      'request:r-2.bearer.token', // request "Z request"
    ]);
  });

  it('orders OAuth2 fields as clientSecret → accessToken → refreshToken', () => {
    const env = envelopeWithRequestAuth({
      type: 'oauth2-client-credentials',
      tokenUrl: 'https://idp',
      clientId: 'cid',
      clientSecret: 'cs',
      scope: '',
      clientAuthMethod: 'body',
      accessToken: 'at',
      tokenType: 'Bearer',
      refreshToken: 'rt',
      expiresAt: 0,
      obtainedScope: '',
    });
    const creds = collectFolderExportCredentials(env);
    expect(creds.map((c) => c.field)).toEqual(['clientSecret', 'accessToken', 'refreshToken']);
  });
});

describe('redactFolderExportCredentials', () => {
  it('redacts every detected credential when includeIds is empty', () => {
    const env = envelopeWithRequestAuth({ type: 'bearer', token: 'live-token' });
    const redacted = redactFolderExportCredentials(env);
    const auth = redacted.folder.requests[0].auth;
    if (auth.type !== 'bearer') throw new Error('expected bearer');
    expect(auth.token).toBe('');
  });

  it('preserves a credential when its id is in the include set', () => {
    const env = envelopeWithRequestAuth({ type: 'bearer', token: 'live-token' });
    const include = new Set(['request:r-1.bearer.token']);
    const redacted = redactFolderExportCredentials(env, include);
    const auth = redacted.folder.requests[0].auth;
    if (auth.type !== 'bearer') throw new Error('expected bearer');
    expect(auth.token).toBe('live-token');
  });

  it('redacts root-folder auth credentials', () => {
    const env = envelopeWithRootAuth({ type: 'basic', username: 'u', password: 'p' });
    const redacted = redactFolderExportCredentials(env);
    const auth = redacted.folder.auth;
    if (!auth || auth.type !== 'basic') throw new Error('expected basic');
    expect(auth.password).toBe('');
    expect(auth.username).toBe('u'); // identity field preserved
  });

  it('leaves the root-folder auth untouched when undefined', () => {
    const env = envelopeWithRootAuth(undefined);
    const redacted = redactFolderExportCredentials(env);
    expect(redacted.folder.auth).toBeUndefined();
  });

  it('redacts subfolder auth credentials', () => {
    const env: ApicircleFolderExportV1 = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        subfolders: [
          {
            id: 'f-child',
            name: 'Child',
            parentId: 'f-root',
            auth: { type: 'basic', username: 'u', password: 'p' },
          },
        ],
        requests: [],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const redacted = redactFolderExportCredentials(env);
    const sub = redacted.folder.subfolders[0];
    if (!sub.auth || sub.auth.type !== 'basic') throw new Error('expected basic');
    expect(sub.auth.password).toBe('');
  });

  it('passes through subfolders without auth verbatim', () => {
    const env: ApicircleFolderExportV1 = {
      ...envelopeWithRootAuth(undefined),
      folder: {
        name: 'Root',
        subfolders: [{ id: 'f-child', name: 'Child', parentId: 'f-root' }],
        requests: [],
      },
    };
    const redacted = redactFolderExportCredentials(env);
    expect(redacted.folder.subfolders[0].auth).toBeUndefined();
  });

  it.each([
    ['none', { type: 'none' }],
    ['inherit', { type: 'inherit' }],
    ['custom-header', { type: 'custom-header', key: 'X-T', value: 'v' }],
  ] as const)('does not modify "%s" auth (no credential fields)', (_label, auth) => {
    const env = envelopeWithRequestAuth(auth as RequestAuth);
    const redacted = redactFolderExportCredentials(env);
    expect(redacted.folder.requests[0].auth).toEqual(auth);
  });

  it('blanks each variant correctly when nothing is included', () => {
    const variants: RequestAuth[] = [
      { type: 'basic', username: 'u', password: 'p' },
      { type: 'bearer', token: 'tk' },
      { type: 'api-key', key: 'X', value: 'v', addTo: 'header' },
      { type: 'digest', username: 'u', password: 'p' },
      { type: 'ntlm', username: 'u', password: 'p', domain: '', workstation: '' },
      {
        type: 'hawk',
        hawkId: 'id',
        hawkKey: 'k',
        algorithm: 'sha256',
        ext: '',
      },
      {
        type: 'jwt-bearer',
        algorithm: 'HS256',
        secretOrKey: 'sk',
        payload: '{}',
        jwtHeaders: '{}',
        token: 'tok',
      },
      {
        type: 'aws-sigv4',
        accessKeyId: 'AKIA',
        secretAccessKey: 'sk',
        sessionToken: 'st',
        region: '',
        service: '',
        addTo: 'header',
      },
      {
        type: 'oauth2-client-credentials',
        tokenUrl: '',
        clientId: '',
        clientSecret: 'cs',
        scope: '',
        clientAuthMethod: 'body',
        accessToken: 'at',
        tokenType: 'Bearer',
        refreshToken: 'rt',
        expiresAt: 0,
        obtainedScope: '',
      },
      {
        type: 'oauth2-auth-code',
        authUrl: '',
        tokenUrl: '',
        clientId: '',
        clientSecret: 'cs',
        redirectUri: '',
        scope: '',
        state: '',
        accessToken: 'at',
        tokenType: 'Bearer',
        refreshToken: 'rt',
        expiresAt: 0,
        obtainedScope: '',
      },
      {
        type: 'oauth2-pkce',
        authUrl: '',
        tokenUrl: '',
        clientId: '',
        clientSecret: 'cs',
        redirectUri: '',
        scope: '',
        state: '',
        codeVerifier: '',
        codeChallengeMethod: 'S256',
        accessToken: 'at',
        tokenType: 'Bearer',
        refreshToken: 'rt',
        expiresAt: 0,
        obtainedScope: '',
      },
      {
        type: 'oauth2-password',
        tokenUrl: '',
        clientId: '',
        clientSecret: 'cs',
        username: 'u',
        password: 'p',
        scope: '',
        accessToken: 'at',
        tokenType: 'Bearer',
        refreshToken: 'rt',
        expiresAt: 0,
        obtainedScope: '',
      },
      {
        type: 'oauth2-implicit',
        authUrl: '',
        clientId: '',
        redirectUri: '',
        scope: '',
        accessToken: 'at',
        tokenType: 'Bearer',
        expiresAt: 0,
        obtainedScope: '',
      },
      {
        type: 'oauth2-device',
        deviceAuthUrl: '',
        tokenUrl: '',
        clientId: '',
        scope: '',
        deviceCode: '',
        userCode: '',
        verificationUri: '',
        accessToken: 'at',
        tokenType: 'Bearer',
        refreshToken: 'rt',
        expiresAt: 0,
        obtainedScope: '',
      },
    ];
    for (const auth of variants) {
      const env = envelopeWithRequestAuth(auth);
      const redacted = redactFolderExportCredentials(env);
      const after = redacted.folder.requests[0].auth as Record<string, unknown>;
      // Every credential field detected from the same auth must now be ''.
      const creds = collectFolderExportCredentials(env);
      for (const cred of creds) {
        expect(after[cred.field]).toBe('');
      }
    }
  });

  it('preserves a single included credential while redacting others (OAuth2 password grant)', () => {
    const env = envelopeWithRequestAuth({
      type: 'oauth2-password',
      tokenUrl: '',
      clientId: '',
      clientSecret: 'cs',
      username: 'u',
      password: 'pw',
      scope: '',
      accessToken: 'at',
      tokenType: 'Bearer',
      refreshToken: 'rt',
      expiresAt: 0,
      obtainedScope: '',
    });
    const include = new Set(['request:r-1.oauth2-password.accessToken']);
    const redacted = redactFolderExportCredentials(env, include);
    const auth = redacted.folder.requests[0].auth;
    if (auth.type !== 'oauth2-password') throw new Error('expected oauth2-password');
    expect(auth.clientSecret).toBe('');
    expect(auth.password).toBe('');
    expect(auth.refreshToken).toBe('');
    expect(auth.accessToken).toBe('at'); // kept
  });
});

describe('redactFolderExportCredentials — exhaustive variant coverage', () => {
  it.each([
    ['api-key', { type: 'api-key', key: 'X', value: 'v', addTo: 'header' } as RequestAuth, 'value'],
    [
      'hawk',
      { type: 'hawk', hawkId: 'id', hawkKey: 'k', algorithm: 'sha256', ext: '' } as RequestAuth,
      'hawkKey',
    ],
    [
      'oauth2-auth-code',
      {
        type: 'oauth2-auth-code',
        authUrl: '',
        tokenUrl: '',
        clientId: '',
        clientSecret: 'cs',
        redirectUri: '',
        scope: '',
        state: '',
        accessToken: 'at',
        tokenType: 'Bearer',
        refreshToken: 'rt',
        expiresAt: 0,
        obtainedScope: '',
      } as RequestAuth,
      'clientSecret',
    ],
    [
      'oauth2-pkce',
      {
        type: 'oauth2-pkce',
        authUrl: '',
        tokenUrl: '',
        clientId: '',
        clientSecret: 'cs',
        redirectUri: '',
        scope: '',
        state: '',
        codeVerifier: '',
        codeChallengeMethod: 'S256',
        accessToken: 'at',
        tokenType: 'Bearer',
        refreshToken: 'rt',
        expiresAt: 0,
        obtainedScope: '',
      } as RequestAuth,
      'clientSecret',
    ],
  ])('blanks the %s field on default redaction', (_label, auth, field) => {
    const env = envelopeWithRequestAuth(auth);
    const redacted = redactFolderExportCredentials(env);
    const after = redacted.folder.requests[0].auth as Record<string, unknown>;
    expect(after[field]).toBe('');
  });

  it('emits zero credentials when an oauth2-password variant has empty fields', () => {
    const env = envelopeWithRequestAuth({
      type: 'oauth2-password',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      username: '',
      password: '',
      scope: '',
      accessToken: '',
      tokenType: 'Bearer',
      refreshToken: '',
      expiresAt: 0,
      obtainedScope: '',
    });
    expect(collectFolderExportCredentials(env)).toEqual([]);
  });

  it('emits zero credentials when an oauth2-implicit variant has an empty accessToken', () => {
    const env = envelopeWithRequestAuth({
      type: 'oauth2-implicit',
      authUrl: '',
      clientId: '',
      redirectUri: '',
      scope: '',
      accessToken: '',
      tokenType: 'Bearer',
      expiresAt: 0,
      obtainedScope: '',
    });
    expect(collectFolderExportCredentials(env)).toEqual([]);
  });

  it('emits zero credentials when an oauth2-* variant has empty clientSecret + tokens', () => {
    const env = envelopeWithRequestAuth({
      type: 'oauth2-client-credentials',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      clientAuthMethod: 'body',
      accessToken: '',
      tokenType: 'Bearer',
      refreshToken: '',
      expiresAt: 0,
      obtainedScope: '',
    });
    expect(collectFolderExportCredentials(env)).toEqual([]);
  });

  it('emits zero credentials when an aws-sigv4 variant has empty secret + sessionToken', () => {
    const env = envelopeWithRequestAuth({
      type: 'aws-sigv4',
      accessKeyId: 'AKIA',
      secretAccessKey: '',
      sessionToken: '',
      region: '',
      service: '',
      addTo: 'header',
    });
    expect(collectFolderExportCredentials(env)).toEqual([]);
  });

  it('emits zero credentials when a jwt-bearer variant has empty secretOrKey + token', () => {
    const env = envelopeWithRequestAuth({
      type: 'jwt-bearer',
      algorithm: 'HS256',
      secretOrKey: '',
      payload: '{}',
      jwtHeaders: '{}',
      token: '',
    });
    expect(collectFolderExportCredentials(env)).toEqual([]);
  });

  it('emits zero credentials when an oauth2-device variant has empty tokens', () => {
    const env = envelopeWithRequestAuth({
      type: 'oauth2-device',
      deviceAuthUrl: '',
      tokenUrl: '',
      clientId: '',
      scope: '',
      deviceCode: '',
      userCode: '',
      verificationUri: '',
      accessToken: '',
      tokenType: 'Bearer',
      refreshToken: '',
      expiresAt: 0,
      obtainedScope: '',
    });
    expect(collectFolderExportCredentials(env)).toEqual([]);
  });

  it('redacts oauth2-implicit accessToken on default redaction', () => {
    const env = envelopeWithRequestAuth({
      type: 'oauth2-implicit',
      authUrl: '',
      clientId: '',
      redirectUri: '',
      scope: '',
      accessToken: 'at',
      tokenType: 'Bearer',
      expiresAt: 0,
      obtainedScope: '',
    });
    const redacted = redactFolderExportCredentials(env);
    const auth = redacted.folder.requests[0].auth;
    if (auth.type !== 'oauth2-implicit') throw new Error('expected oauth2-implicit');
    expect(auth.accessToken).toBe('');
  });

  it('redacts oauth2-device accessToken + refreshToken on default redaction', () => {
    const env = envelopeWithRequestAuth({
      type: 'oauth2-device',
      deviceAuthUrl: '',
      tokenUrl: '',
      clientId: '',
      scope: '',
      deviceCode: '',
      userCode: '',
      verificationUri: '',
      accessToken: 'at',
      tokenType: 'Bearer',
      refreshToken: 'rt',
      expiresAt: 0,
      obtainedScope: '',
    });
    const redacted = redactFolderExportCredentials(env);
    const auth = redacted.folder.requests[0].auth;
    if (auth.type !== 'oauth2-device') throw new Error('expected oauth2-device');
    expect(auth.accessToken).toBe('');
    expect(auth.refreshToken).toBe('');
  });

  it('detects only accessToken when oauth2-device has empty refreshToken', () => {
    const env = envelopeWithRequestAuth({
      type: 'oauth2-device',
      deviceAuthUrl: '',
      tokenUrl: '',
      clientId: '',
      scope: '',
      deviceCode: '',
      userCode: '',
      verificationUri: '',
      accessToken: 'at',
      tokenType: 'Bearer',
      refreshToken: '',
      expiresAt: 0,
      obtainedScope: '',
    });
    const creds = collectFolderExportCredentials(env);
    expect(creds.map((c) => c.field)).toEqual(['accessToken']);
  });

  it('passes a "custom-header" auth through redaction unchanged', () => {
    const env = envelopeWithRequestAuth({
      type: 'custom-header',
      key: 'X-Token',
      value: 'sensitive',
    });
    const redacted = redactFolderExportCredentials(env);
    expect(redacted.folder.requests[0].auth).toEqual({
      type: 'custom-header',
      key: 'X-Token',
      value: 'sensitive',
    });
  });

  it('returns the same exhaustive defaults for an unknown synthetic auth (cast)', () => {
    // Force the unreachable default branches in both authCredentialFields
    // and redactAuthForScope so we exercise the fall-through paths the
    // type system guards against at compile time.
    const unsupported = { type: 'mystery-future-auth' } as unknown as RequestAuth;
    const env = envelopeWithRequestAuth(unsupported);
    // collectFolderExportCredentials hits the authCredentialFields default
    expect(collectFolderExportCredentials(env)).toEqual([]);
    // redactFolderExportCredentials hits the redactAuthForScope default —
    // identity transform because no credential ids were detected.
    expect(redactFolderExportCredentials(env)).toEqual(env);
  });
});

describe('collectFolderExport surfaces the credentials report', () => {
  it('lists credentials when a folder contains bearer-secured requests', () => {
    const synced: WorkspaceSynced = {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: {
          'r-1': {
            id: 'r-1',
            name: 'GET /me',
            folderId: 'f-root',
            method: 'GET',
            url: 'https://x',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'bearer', token: 'tk' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: ISO,
            updatedAt: ISO,
          },
        },
        folders: { 'f-root': { id: 'f-root', name: 'Auth', parentId: null } },
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      meta: { createdAt: ISO, updatedAt: ISO, appVersion: '1.0.6' },
    };
    const { report } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(report.hasCredentials).toBe(true);
    expect(report.credentials).toHaveLength(1);
    const [cred] = report.credentials;
    expect((cred as FolderExportCredential).id).toBe('request:r-1.bearer.token');
  });
});
