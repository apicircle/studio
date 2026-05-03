// Per-type default factories for RequestAuth. Used by:
//   • workspaceStore.addRequest → seed `auth: { type: 'none' }` on new
//     requests
//   • normalizeRequest (hydrate path) → upgrade older synced docs that
//     pre-date the auth field
//   • AuthTab → provide the right blank shape when the user changes the
//     auth-type radio
//
// Lives in @apicircle/shared so both core (request-build) and
// ui-components can import it without crossing layers the wrong way.

import type {
  AwsSigV4Auth,
  DigestAuth,
  HawkAuth,
  JwtBearerAuth,
  NtlmAuth,
  OAuth2AuthCodeAuth,
  OAuth2ClientCredentialsAuth,
  OAuth2DeviceAuth,
  OAuth2ImplicitAuth,
  OAuth2PasswordAuth,
  OAuth2PkceAuth,
  RequestAuth,
} from './types';

export type RequestAuthType = RequestAuth['type'];

const oauth2TokenDefaults = {
  accessToken: '',
  tokenType: 'Bearer',
  refreshToken: '',
  expiresAt: null as number | null,
  obtainedScope: '',
};

const FACTORIES: { [K in RequestAuthType]: () => Extract<RequestAuth, { type: K }> } = {
  none: () => ({ type: 'none' }),
  inherit: () => ({ type: 'inherit' }),
  bearer: () => ({ type: 'bearer', token: '' }),
  basic: () => ({ type: 'basic', username: '', password: '' }),
  'api-key': () => ({ type: 'api-key', key: '', value: '', addTo: 'header' }),
  'custom-header': () => ({ type: 'custom-header', key: '', value: '' }),
  'oauth2-client-credentials': (): OAuth2ClientCredentialsAuth => ({
    type: 'oauth2-client-credentials',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    scope: '',
    clientAuthMethod: 'header',
    ...oauth2TokenDefaults,
  }),
  'oauth2-auth-code': (): OAuth2AuthCodeAuth => ({
    type: 'oauth2-auth-code',
    authUrl: '',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    scope: '',
    state: '',
    ...oauth2TokenDefaults,
  }),
  'oauth2-pkce': (): OAuth2PkceAuth => ({
    type: 'oauth2-pkce',
    authUrl: '',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    scope: '',
    state: '',
    codeVerifier: '',
    codeChallengeMethod: 'S256',
    ...oauth2TokenDefaults,
  }),
  'oauth2-password': (): OAuth2PasswordAuth => ({
    type: 'oauth2-password',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    username: '',
    password: '',
    scope: '',
    ...oauth2TokenDefaults,
  }),
  'oauth2-implicit': (): OAuth2ImplicitAuth => ({
    type: 'oauth2-implicit',
    authUrl: '',
    clientId: '',
    redirectUri: '',
    scope: '',
    accessToken: '',
    tokenType: 'Bearer',
    expiresAt: null,
    obtainedScope: '',
  }),
  'oauth2-device': (): OAuth2DeviceAuth => ({
    type: 'oauth2-device',
    deviceAuthUrl: '',
    tokenUrl: '',
    clientId: '',
    scope: '',
    deviceCode: '',
    userCode: '',
    verificationUri: '',
    ...oauth2TokenDefaults,
  }),
  'aws-sigv4': (): AwsSigV4Auth => ({
    type: 'aws-sigv4',
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: '',
    region: 'us-east-1',
    service: '',
    addTo: 'header',
  }),
  digest: (): DigestAuth => ({ type: 'digest', username: '', password: '' }),
  ntlm: (): NtlmAuth => ({
    type: 'ntlm',
    username: '',
    password: '',
    domain: '',
    workstation: '',
  }),
  hawk: (): HawkAuth => ({
    type: 'hawk',
    hawkId: '',
    hawkKey: '',
    algorithm: 'sha256',
    ext: '',
  }),
  'jwt-bearer': (): JwtBearerAuth => ({
    type: 'jwt-bearer',
    algorithm: 'HS256',
    secretOrKey: '',
    payload: '{\n  "sub": "user-id",\n  "iat": 1700000000\n}',
    jwtHeaders: '{\n  "typ": "JWT"\n}',
    token: '',
  }),
};

export function defaultAuthFor<T extends RequestAuthType>(
  type: T,
): Extract<RequestAuth, { type: T }> {
  return FACTORIES[type]();
}

/** Best-effort upgrade of an unknown value into a valid RequestAuth. */
export function normalizeAuth(input: unknown): RequestAuth {
  if (
    input &&
    typeof input === 'object' &&
    'type' in input &&
    typeof input.type === 'string' &&
    (input as { type: string }).type in FACTORIES
  ) {
    return input as RequestAuth;
  }
  return { type: 'none' };
}

export const REQUEST_AUTH_TYPES: ReadonlyArray<RequestAuthType> = Object.keys(
  FACTORIES,
) as Array<RequestAuthType>;
