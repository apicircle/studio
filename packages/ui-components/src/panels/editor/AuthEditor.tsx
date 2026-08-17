// Reusable auth-type picker + per-type form. Used by both AuthTab (per
// request) and FolderAuthModal (folder-level). The hosting component owns
// the auth state and supplies an onChange — this editor is purely
// controlled.
//
// Layout model (UX-S-012): the scheme picker is a single grouped <select>,
// followed by a one-line description of the chosen scheme (so the 17-way
// choice carries information scent instead of being picked blind), and then
// the per-scheme credentials grouped in a labelled <fieldset>. Labels come
// from the shared Field/Label primitives — the private field scaffolding this
// file used to carry is gone.

import type {
  AwsSigV4Auth,
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
  RequestAuthType,
} from '@apicircle/shared';
import {
  defaultAuthFor,
  validateAwsRegion,
  validateHttpHeaderName,
  validateJsonString,
} from '@apicircle/shared';
import { Field } from '../../primitives/Field';
import { SecretInput } from '../../primitives/SecretInput';
import { cn } from '../../primitives/cn';
import { Select } from '../../primitives/Select';
import { OAuth2FlowActions } from './OAuth2FlowActions';

export interface AuthEditorProps {
  auth: RequestAuth;
  onChange: (next: RequestAuth) => void;
  /** When true, hides the 'inherit' option (folder-level auth can't inherit from itself). */
  disableInherit?: boolean;
  /** Override label for the 'No Auth' note. */
  noneNote?: string;
  /** Override label for the 'Inherit' note. */
  inheritNote?: string;
}

const AUTH_GROUPS: Array<{
  label: string;
  types: Array<{ id: RequestAuthType; label: string }>;
}> = [
  {
    label: 'Basic',
    types: [
      { id: 'none', label: 'No Auth' },
      { id: 'inherit', label: 'Inherit (parent folder)' },
      { id: 'bearer', label: 'Bearer Token' },
      { id: 'basic', label: 'Basic Auth' },
      { id: 'api-key', label: 'API Key' },
      { id: 'custom-header', label: 'Custom Header' },
    ],
  },
  {
    label: 'OAuth 2.0',
    types: [
      { id: 'oauth2-client-credentials', label: 'OAuth2 — Client Credentials' },
      { id: 'oauth2-auth-code', label: 'OAuth2 — Authorization Code' },
      { id: 'oauth2-pkce', label: 'OAuth2 — Authorization Code (PKCE)' },
      { id: 'oauth2-password', label: 'OAuth2 — Password (ROPC)' },
      { id: 'oauth2-implicit', label: 'OAuth2 — Implicit' },
      { id: 'oauth2-device', label: 'OAuth2 — Device Code' },
    ],
  },
  {
    label: 'Advanced',
    types: [
      { id: 'aws-sigv4', label: 'AWS Signature v4' },
      { id: 'digest', label: 'Digest' },
      { id: 'ntlm', label: 'NTLM' },
      { id: 'hawk', label: 'Hawk' },
      { id: 'jwt-bearer', label: 'JWT Bearer' },
    ],
  },
];

/** Flat id → human label, derived from the grouped picker options. */
const AUTH_LABEL: Record<string, string> = Object.fromEntries(
  AUTH_GROUPS.flatMap((group) => group.types.map((t) => [t.id, t.label] as const)),
);

/**
 * One-line scent for each scheme, shown under the picker so the user knows
 * what they just chose (and what it needs) before the fields appear. Phrasing
 * kept in step with the Help Center's "Auth types" entry.
 */
const AUTH_BLURBS: Record<RequestAuthType, string> = {
  none: 'No credentials are attached — the request is sent unauthenticated.',
  inherit: 'Reuses the nearest parent folder that sets an explicit auth.',
  bearer: 'Sends an Authorization: Bearer <token> header.',
  basic: 'Username and password, base64-encoded into an Authorization: Basic header.',
  'api-key': 'A single key sent in a header, query parameter, or cookie.',
  'custom-header': 'One arbitrary header name and value.',
  'oauth2-client-credentials':
    'Machine-to-machine: exchanges a client id and secret for a token — no user involved.',
  'oauth2-auth-code':
    'Redirect-based user sign-in that exchanges an authorization code for a token.',
  'oauth2-pkce': 'Authorization Code with a PKCE verifier — the safe choice for public clients.',
  'oauth2-password': 'Exchanges a username and password directly for a token (ROPC).',
  'oauth2-implicit': 'Legacy browser flow that returns a token straight from the redirect.',
  'oauth2-device':
    'For input-constrained devices — poll for a token while the user approves elsewhere.',
  'aws-sigv4': 'Signs the request with AWS Signature v4 credentials.',
  digest: 'Challenge-response using a digest of the credentials (sent after a 401).',
  ntlm: 'Windows NTLM challenge-response handshake.',
  hawk: 'MAC-based scheme signing each request with an id and key.',
  'jwt-bearer': 'Builds (or accepts) a signed JWT and sends it as a Bearer token.',
};

const inputClass =
  'h-8 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30';
const gridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2';
const noteClass =
  'rounded-sm border border-border-subtle bg-surface px-2 py-1.5 text-[0.6875rem] text-text-muted';
const blurbClass = 'text-xs leading-relaxed text-text-muted';
// Keep the <fieldset> a normal block so the <legend> renders on the border in
// every browser (a display:flex fieldset mishandles the legend in some); the
// inner wrapper does the vertical layout.
const fieldsetClass = 'min-w-0 rounded-md border border-border-subtle bg-surface/40 p-3';
const fieldsetBodyClass = 'flex min-w-0 flex-col gap-3';
const legendClass = 'px-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-text-muted';

export function AuthEditor({
  auth,
  onChange,
  disableInherit = false,
  noneNote,
  inheritNote,
}: AuthEditorProps) {
  const onChangeType = (next: RequestAuthType) => {
    if (next === auth.type) return;
    onChange(defaultAuthFor(next));
  };

  const update = <T extends RequestAuth>(patch: Partial<T>) => {
    onChange({ ...(auth as T), ...patch });
  };

  const configurable = auth.type !== 'none' && auth.type !== 'inherit';

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <Field label="Auth type">
        {(f) => (
          <Select
            {...f}
            size="md"
            value={auth.type}
            onChange={(e) => onChangeType(e.target.value as RequestAuthType)}
            // The Field's visible <label> already names this select; an explicit
            // aria-label here doubled the screen-reader readout.
            className="text-text-primary"
            wrapperClassName="w-full max-w-sm"
          >
            {AUTH_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.types
                  .filter((t) => !(disableInherit && t.id === 'inherit'))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        )}
      </Field>

      {auth.type === 'none' && (
        <p className={noteClass}>{noneNote ?? 'No authentication will be added.'}</p>
      )}

      {auth.type === 'inherit' && (
        <p className={noteClass}>
          {inheritNote ??
            'At send time, the resolver walks up the folder chain and uses the first folder with an explicit auth set. If none is found, the request goes out unauthenticated.'}
        </p>
      )}

      {configurable && (
        <>
          <p className={blurbClass}>{AUTH_BLURBS[auth.type]}</p>
          <fieldset className={fieldsetClass}>
            <legend className={legendClass}>{AUTH_LABEL[auth.type]}</legend>
            <div className={fieldsetBodyClass}>
              {auth.type === 'bearer' && (
                <Field label="Token">
                  {(f) => (
                    <SecretInput
                      id={f.id}
                      ariaLabel="Bearer token"
                      value={auth.token}
                      onChange={(v) => update({ token: v })}
                      placeholder="eyJhbGciOi…"
                    />
                  )}
                </Field>
              )}

              {auth.type === 'basic' && (
                <div className={gridClass}>
                  <Field label="Username">
                    {(f) => (
                      <input
                        id={f.id}
                        aria-label="Username"
                        value={auth.username}
                        onChange={(e) => update({ username: e.target.value })}
                        className={inputClass}
                      />
                    )}
                  </Field>
                  <Field label="Password">
                    {(f) => (
                      <SecretInput
                        id={f.id}
                        ariaLabel="Password"
                        value={auth.password}
                        onChange={(v) => update({ password: v })}
                      />
                    )}
                  </Field>
                </div>
              )}

              {auth.type === 'api-key' && (
                <>
                  <div className={gridClass}>
                    <Field label="Key">
                      {(f) => (
                        <input
                          id={f.id}
                          aria-label="API key name"
                          value={auth.key}
                          onChange={(e) => update({ key: e.target.value })}
                          className={inputClass}
                          placeholder="X-API-Key"
                        />
                      )}
                    </Field>
                    <Field label="Value">
                      {(f) => (
                        <SecretInput
                          id={f.id}
                          ariaLabel="API key value"
                          value={auth.value}
                          onChange={(v) => update({ value: v })}
                        />
                      )}
                    </Field>
                  </div>
                  <Field label="Location">
                    {(f) => (
                      <Select
                        {...f}
                        size="md"
                        aria-label="API key location"
                        value={auth.addTo}
                        onChange={(e) =>
                          update({ addTo: e.target.value as 'header' | 'query' | 'cookie' })
                        }
                        className="text-text-primary"
                        wrapperClassName="w-full max-w-xs"
                      >
                        <option value="header">Header</option>
                        <option value="query">Query parameter</option>
                        <option value="cookie">Cookie</option>
                      </Select>
                    )}
                  </Field>
                </>
              )}

              {auth.type === 'custom-header' && (
                <div className={gridClass}>
                  <Field label="Header name">
                    {(f) => (
                      <CustomHeaderNameInput
                        id={f.id}
                        value={auth.key}
                        onChange={(v) => update({ key: v })}
                      />
                    )}
                  </Field>
                  <Field label="Header value">
                    {(f) => (
                      <SecretInput
                        id={f.id}
                        ariaLabel="Header value"
                        value={auth.value}
                        onChange={(v) => update({ value: v })}
                      />
                    )}
                  </Field>
                </div>
              )}

              {auth.type === 'oauth2-client-credentials' && (
                <>
                  <OAuth2Form
                    auth={auth}
                    onChange={update}
                    fields={['tokenUrl', 'clientId', 'clientSecret', 'scope']}
                    extra={
                      <Field label="Client auth method">
                        {(f) => (
                          <Select
                            {...f}
                            size="md"
                            aria-label="Client auth method"
                            value={auth.clientAuthMethod}
                            onChange={(e) =>
                              update({ clientAuthMethod: e.target.value as 'header' | 'body' })
                            }
                            className="text-text-primary"
                            wrapperClassName="w-full max-w-xs"
                          >
                            <option value="header">Header (Basic auth)</option>
                            <option value="body">Body</option>
                          </Select>
                        )}
                      </Field>
                    }
                  />
                  <OAuth2FlowActions auth={auth} onChange={onChange} />
                </>
              )}

              {auth.type === 'oauth2-auth-code' && (
                <>
                  <OAuth2Form
                    auth={auth}
                    onChange={update}
                    fields={[
                      'authUrl',
                      'tokenUrl',
                      'clientId',
                      'clientSecret',
                      'redirectUri',
                      'scope',
                      'state',
                    ]}
                  />
                  <OAuth2FlowActions auth={auth} onChange={onChange} />
                </>
              )}

              {auth.type === 'oauth2-pkce' && (
                <>
                  <OAuth2Form
                    auth={auth}
                    onChange={update}
                    fields={[
                      'authUrl',
                      'tokenUrl',
                      'clientId',
                      'clientSecret',
                      'redirectUri',
                      'scope',
                      'state',
                      'codeVerifier',
                    ]}
                    extra={
                      <Field label="Code challenge method">
                        {(f) => (
                          <Select
                            {...f}
                            size="md"
                            aria-label="PKCE code challenge method"
                            value={auth.codeChallengeMethod}
                            onChange={(e) =>
                              update({ codeChallengeMethod: e.target.value as 'S256' | 'plain' })
                            }
                            className="text-text-primary"
                            wrapperClassName="w-full max-w-xs"
                          >
                            <option value="S256">S256 (recommended)</option>
                            <option value="plain">plain</option>
                          </Select>
                        )}
                      </Field>
                    }
                  />
                  <OAuth2FlowActions auth={auth} onChange={onChange} />
                </>
              )}

              {auth.type === 'oauth2-password' && (
                <>
                  <OAuth2Form
                    auth={auth}
                    onChange={update}
                    fields={[
                      'tokenUrl',
                      'clientId',
                      'clientSecret',
                      'username',
                      'password',
                      'scope',
                    ]}
                  />
                  <OAuth2FlowActions auth={auth} onChange={onChange} />
                </>
              )}

              {auth.type === 'oauth2-implicit' && (
                <>
                  <OAuth2Form
                    auth={auth}
                    onChange={update}
                    fields={['authUrl', 'clientId', 'redirectUri', 'scope']}
                  />
                  <OAuth2FlowActions auth={auth} onChange={onChange} />
                </>
              )}

              {auth.type === 'oauth2-device' && (
                <>
                  <OAuth2Form
                    auth={auth}
                    onChange={update}
                    fields={['deviceAuthUrl', 'tokenUrl', 'clientId', 'scope']}
                  />
                  <OAuth2FlowActions auth={auth} onChange={onChange} />
                </>
              )}

              {auth.type === 'aws-sigv4' && <AwsSigV4Form auth={auth} update={update} />}
              {auth.type === 'hawk' && <HawkForm auth={auth} update={update} />}
              {auth.type === 'jwt-bearer' && <JwtBearerForm auth={auth} update={update} />}
              {auth.type === 'digest' && (
                <DigestNtlmForm kind="digest" auth={auth} update={update} />
              )}
              {auth.type === 'ntlm' && <DigestNtlmForm kind="ntlm" auth={auth} update={update} />}
            </div>
          </fieldset>
        </>
      )}
    </div>
  );
}

// --- OAuth2 shared form -------------------------------------------------

type OAuth2Like =
  | OAuth2ClientCredentialsAuth
  | OAuth2AuthCodeAuth
  | OAuth2PkceAuth
  | OAuth2PasswordAuth
  | OAuth2ImplicitAuth
  | OAuth2DeviceAuth;

interface OAuth2FormProps<T extends OAuth2Like> {
  auth: T;
  onChange: (patch: Partial<T>) => void;
  fields: Array<keyof T>;
  extra?: React.ReactNode;
}

const OAUTH2_FIELD_LABELS: Record<
  string,
  { label: string; secret?: boolean; placeholder?: string }
> = {
  authUrl: { label: 'Authorization URL', placeholder: 'https://auth.example.com/authorize' },
  tokenUrl: { label: 'Token URL', placeholder: 'https://auth.example.com/token' },
  deviceAuthUrl: { label: 'Device authorization URL' },
  clientId: { label: 'Client ID' },
  clientSecret: { label: 'Client secret', secret: true },
  redirectUri: { label: 'Redirect URI' },
  scope: { label: 'Scope', placeholder: 'read write' },
  state: { label: 'State' },
  codeVerifier: { label: 'Code verifier (PKCE)', secret: true },
  username: { label: 'Username' },
  password: { label: 'Password', secret: true },
};

function OAuth2Form<T extends OAuth2Like>({ auth, onChange, fields, extra }: OAuth2FormProps<T>) {
  return (
    <div className="flex flex-col gap-3">
      <div className={gridClass}>
        {fields.map((field) => {
          const meta = OAUTH2_FIELD_LABELS[field as string] ?? { label: field as string };
          const value = (auth[field] as unknown as string) ?? '';
          return (
            <Field key={String(field)} label={meta.label}>
              {(f) =>
                meta.secret ? (
                  <SecretInput
                    id={f.id}
                    ariaLabel={meta.label}
                    value={value}
                    onChange={(v) => onChange({ [field]: v } as Partial<T>)}
                  />
                ) : (
                  <input
                    id={f.id}
                    aria-label={meta.label}
                    value={value}
                    placeholder={meta.placeholder}
                    onChange={(e) => onChange({ [field]: e.target.value } as Partial<T>)}
                    className={inputClass}
                  />
                )
              }
            </Field>
          );
        })}
        {extra}
      </div>
      {/*
        Token acquisition + cached token state are owned by OAuth2FlowActions
        (rendered alongside the OAuth2 form by the AuthTab consumer). The
        previous TokenStatePanel here was stale code from before the flow
        runner shipped — paste-a-token-manually was a temporary workaround.
      */}
    </div>
  );
}

// --- AWS SigV4 ----------------------------------------------------------

function AwsSigV4Form({
  auth,
  update,
}: {
  auth: AwsSigV4Auth;
  update: (patch: Partial<AwsSigV4Auth>) => void;
}) {
  return (
    <div className={gridClass}>
      <Field label="Access key ID">
        {(f) => (
          <input
            id={f.id}
            aria-label="AWS access key ID"
            value={auth.accessKeyId}
            onChange={(e) => update({ accessKeyId: e.target.value })}
            className={inputClass}
          />
        )}
      </Field>
      <Field label="Secret access key">
        {(f) => (
          <SecretInput
            id={f.id}
            ariaLabel="AWS secret access key"
            value={auth.secretAccessKey}
            onChange={(v) => update({ secretAccessKey: v })}
          />
        )}
      </Field>
      <Field label="Region">
        {(f) => (
          <RegionInput id={f.id} value={auth.region} onChange={(v) => update({ region: v })} />
        )}
      </Field>
      <Field label="Service">
        {(f) => (
          <input
            id={f.id}
            aria-label="AWS service"
            value={auth.service}
            onChange={(e) => update({ service: e.target.value })}
            className={inputClass}
            placeholder="execute-api"
          />
        )}
      </Field>
      <Field label="Session token (optional)">
        {(f) => (
          <SecretInput
            id={f.id}
            ariaLabel="AWS session token"
            value={auth.sessionToken}
            onChange={(v) => update({ sessionToken: v })}
          />
        )}
      </Field>
      <Field label="Signature location">
        {(f) => (
          <Select
            {...f}
            size="md"
            aria-label="SigV4 location"
            value={auth.addTo}
            onChange={(e) => update({ addTo: e.target.value as 'header' | 'query' })}
            className="text-text-primary"
            wrapperClassName="w-full"
          >
            <option value="header">Authorization header</option>
            <option value="query">Query string (presigned)</option>
          </Select>
        )}
      </Field>
    </div>
  );
}

function HawkForm({
  auth,
  update,
}: {
  auth: HawkAuth;
  update: (patch: Partial<HawkAuth>) => void;
}) {
  return (
    <div className={gridClass}>
      <Field label="Hawk ID">
        {(f) => (
          <input
            id={f.id}
            aria-label="Hawk ID"
            value={auth.hawkId}
            onChange={(e) => update({ hawkId: e.target.value })}
            className={inputClass}
          />
        )}
      </Field>
      <Field label="Hawk key">
        {(f) => (
          <SecretInput
            id={f.id}
            ariaLabel="Hawk key"
            value={auth.hawkKey}
            onChange={(v) => update({ hawkKey: v })}
          />
        )}
      </Field>
      <Field label="Algorithm">
        {(f) => (
          <Select
            {...f}
            size="md"
            aria-label="Hawk algorithm"
            value={auth.algorithm}
            onChange={(e) => update({ algorithm: e.target.value as 'sha256' | 'sha1' })}
            className="text-text-primary"
            wrapperClassName="w-full"
          >
            <option value="sha256">SHA-256</option>
            <option value="sha1">SHA-1</option>
          </Select>
        )}
      </Field>
      <Field label="Ext (optional)">
        {(f) => (
          <input
            id={f.id}
            aria-label="Hawk ext"
            value={auth.ext}
            onChange={(e) => update({ ext: e.target.value })}
            className={inputClass}
          />
        )}
      </Field>
    </div>
  );
}

function JwtBearerForm({
  auth,
  update,
}: {
  auth: JwtBearerAuth;
  update: (patch: Partial<JwtBearerAuth>) => void;
}) {
  const isHs = auth.algorithm.startsWith('HS');
  return (
    <div className="flex flex-col gap-3">
      <div className={gridClass}>
        <Field label="Algorithm">
          {(f) => (
            <Select
              {...f}
              size="md"
              aria-label="JWT algorithm"
              value={auth.algorithm}
              onChange={(e) => update({ algorithm: e.target.value as JwtBearerAuth['algorithm'] })}
              className="text-text-primary"
              wrapperClassName="w-full"
            >
              <option value="HS256">HS256</option>
              <option value="HS384">HS384</option>
              <option value="HS512">HS512</option>
              <option value="RS256">RS256 (paste pre-signed token below)</option>
              <option value="RS384">RS384 (paste pre-signed token below)</option>
              <option value="RS512">RS512 (paste pre-signed token below)</option>
              <option value="ES256">ES256 (paste pre-signed token below)</option>
            </Select>
          )}
        </Field>
        <Field label={isHs ? 'Secret (signing key)' : 'Public key (PEM, for reference)'}>
          {(f) => (
            <SecretInput
              id={f.id}
              ariaLabel="JWT signing key"
              value={auth.secretOrKey}
              onChange={(v) => update({ secretOrKey: v })}
            />
          )}
        </Field>
      </div>
      <div className={gridClass}>
        <Field label="Header overrides (JSON)">
          {(f) => (
            <JsonTextarea
              id={f.id}
              ariaLabel="JWT header"
              value={auth.jwtHeaders}
              onChange={(v) => update({ jwtHeaders: v })}
              allowEmpty
              allowRoots="object"
            />
          )}
        </Field>
        <Field label="Payload (JSON)">
          {(f) => (
            <JsonTextarea
              id={f.id}
              ariaLabel="JWT payload"
              value={auth.payload}
              onChange={(v) => update({ payload: v })}
              allowEmpty
              allowRoots="object"
            />
          )}
        </Field>
      </div>
      <Field label="Pre-computed token (optional, overrides signing)">
        {(f) => (
          <SecretInput
            id={f.id}
            ariaLabel="JWT token"
            value={auth.token}
            onChange={(v) => update({ token: v })}
            placeholder="eyJ…"
          />
        )}
      </Field>
      <p className={noteClass}>
        {isHs
          ? 'HS algorithms are signed locally with WebCrypto on send.'
          : 'RS/ES algorithms require a pre-signed token. Paste it in the field above.'}
      </p>
    </div>
  );
}

function DigestNtlmForm({
  kind,
  auth,
  update,
}: {
  kind: 'digest' | 'ntlm';
  auth: NtlmAuth | { type: 'digest'; username: string; password: string };
  update: (patch: Partial<NtlmAuth>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className={gridClass}>
        <Field label="Username">
          {(f) => (
            <input
              id={f.id}
              aria-label={`${kind} username`}
              value={auth.username}
              onChange={(e) => update({ username: e.target.value })}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Password">
          {(f) => (
            <SecretInput
              id={f.id}
              ariaLabel={`${kind} password`}
              value={auth.password}
              onChange={(v) => update({ password: v })}
            />
          )}
        </Field>
        {kind === 'ntlm' && 'domain' in auth && (
          <>
            <Field label="Domain (optional)">
              {(f) => (
                <input
                  id={f.id}
                  aria-label="NTLM domain"
                  value={auth.domain}
                  onChange={(e) => update({ domain: e.target.value })}
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="Workstation (optional)">
              {(f) => (
                <input
                  id={f.id}
                  aria-label="NTLM workstation"
                  value={auth.workstation}
                  onChange={(e) => update({ workstation: e.target.value })}
                  className={inputClass}
                />
              )}
            </Field>
          </>
        )}
      </div>
      <p className={noteClass}>
        {kind === 'digest'
          ? 'Digest is challenge-based. Credentials are sent only after the server returns a 401 with a Digest challenge. Automatic challenge handling is planned for a future phase.'
          : 'NTLM is a multi-round handshake. Credentials are stored and will be applied once handshake support lands in a follow-up phase.'}
      </p>
    </div>
  );
}

/**
 * JSON-validating textarea — surfaces parse errors inline as the user
 * types so they don't only learn at Send time. Used by the JWT header /
 * payload fields (audit gap #26: invalid JSON was silently accepted).
 */
function JsonTextarea({
  id,
  ariaLabel,
  value,
  onChange,
  allowEmpty,
  allowRoots,
}: {
  id?: string;
  ariaLabel: string;
  value: string;
  onChange: (next: string) => void;
  allowEmpty?: boolean;
  allowRoots?: 'object' | 'array' | 'any';
}) {
  const result = validateJsonString(value, { allowEmpty, allowRoots });
  const invalid = !result.ok;
  return (
    <div className="flex flex-col">
      <textarea
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={cn(
          'min-h-[80px] w-full rounded-sm border bg-card p-2 font-mono text-[0.6875rem] text-text-primary focus:outline-none focus:ring-1',
          invalid
            ? 'border-danger focus:border-danger focus:ring-danger/40'
            : 'border-border focus:border-accent focus:ring-accent/30',
        )}
      />
      {invalid && (
        <p role="alert" className="mt-1 text-[0.625rem] text-danger">
          {result.reason}
        </p>
      )}
    </div>
  );
}

/**
 * AWS region input with inline validation. Catches typos like
 * `us-eastt-1` before send (audit gap #27 — region was free text and
 * silently accepted any value). Datalist suggests common regions
 * without locking the user out of new ones.
 */
const COMMON_AWS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-north-1',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'sa-east-1',
  'ca-central-1',
];

function RegionInput({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const result = validateAwsRegion(value);
  const invalid = !result.ok && value.trim().length > 0;
  return (
    <div className="flex flex-col">
      <input
        id={id}
        aria-label="AWS region"
        list="aws-region-suggestions"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-8 w-full rounded-sm border bg-card px-2 text-xs text-text-primary focus:outline-none focus:ring-1',
          invalid
            ? 'border-danger focus:border-danger focus:ring-danger/40'
            : 'border-border focus:border-accent focus:ring-accent/30',
        )}
        placeholder="us-east-1"
        aria-invalid={invalid || undefined}
      />
      <datalist id="aws-region-suggestions">
        {COMMON_AWS_REGIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      {invalid && (
        <p role="alert" className="mt-1 text-[0.625rem] text-danger">
          {result.reason}
        </p>
      )}
    </div>
  );
}

/**
 * Custom-header `auth.key` field. Validates the name as an HTTP token
 * (RFC 7230) at edit time so an invalid header name surfaces *here*
 * instead of corrupting the wire-format at send time.
 */
function CustomHeaderNameInput({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const result = validateHttpHeaderName(value);
  const invalid = !result.ok && value.trim().length > 0;
  return (
    <div className="flex flex-col">
      <input
        id={id}
        aria-label="Header name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="X-Auth"
        className={cn(
          'h-8 w-full rounded-sm border bg-card px-2 text-xs text-text-primary focus:outline-none focus:ring-1',
          invalid
            ? 'border-danger focus:border-danger focus:ring-danger/40'
            : 'border-border focus:border-accent focus:ring-accent/30',
        )}
        aria-invalid={invalid || undefined}
      />
      {invalid && (
        <p role="alert" className="mt-1 text-[0.625rem] text-danger">
          {result.reason}
        </p>
      )}
    </div>
  );
}
