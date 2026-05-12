// Reusable auth-type picker + per-type form. Used by both AuthTab (per
// request) and FolderAuthModal (folder-level). The hosting component owns
// the auth state and supplies an onChange — this editor is purely
// controlled.

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
import { defaultAuthFor, validateAwsRegion, validateJsonString } from '@apicircle/shared';
import { SecretInput } from '../../primitives/SecretInput';
import { cn } from '../../primitives/cn';
import { OAuth2FlowActions } from './OAuth2FlowActions';

export interface AuthEditorProps {
  auth: RequestAuth;
  onChange: (next: RequestAuth) => void;
  /** Prefix for input id attributes — keeps multiple editors distinct. */
  idPrefix: string;
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

const labelClass = 'text-[0.6875rem] uppercase tracking-wide text-text-dim';
const inputClass =
  'h-8 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30';
const fieldsetClass = 'flex flex-col gap-1';
const gridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2';
const noteClass =
  'rounded-sm border border-border-subtle bg-surface px-2 py-1.5 text-[0.6875rem] text-text-muted';

function Field({ id, label, children }: { id?: string; label: string; children: React.ReactNode }) {
  return (
    <div className={fieldsetClass}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function AuthEditor({
  auth,
  onChange,
  idPrefix,
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

  return (
    <div className="flex flex-col gap-3">
      <div className={fieldsetClass}>
        <label htmlFor={`auth-type-${idPrefix}`} className={labelClass}>
          Auth type
        </label>
        <select
          id={`auth-type-${idPrefix}`}
          value={auth.type}
          onChange={(e) => onChangeType(e.target.value as RequestAuthType)}
          // The visible <label htmlFor=...> already names this select; an
          // explicit aria-label here doubled the screen-reader readout.
          className={cn(inputClass, 'max-w-sm')}
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
        </select>
      </div>

      {auth.type === 'none' && (
        <p className={noteClass}>{noneNote ?? 'No authentication will be added.'}</p>
      )}

      {auth.type === 'inherit' && (
        <p className={noteClass}>
          {inheritNote ??
            'At send time, the resolver walks up the folder chain and uses the first folder with an explicit auth set. If none is found, the request goes out unauthenticated.'}
        </p>
      )}

      {auth.type === 'bearer' && (
        <Field id={`bearer-${idPrefix}`} label="Token">
          <SecretInput
            id={`bearer-${idPrefix}`}
            ariaLabel="Bearer token"
            value={auth.token}
            onChange={(v) => update({ token: v })}
            placeholder="eyJhbGciOi…"
          />
        </Field>
      )}

      {auth.type === 'basic' && (
        <div className={gridClass}>
          <Field id={`basic-user-${idPrefix}`} label="Username">
            <input
              id={`basic-user-${idPrefix}`}
              aria-label="Username"
              value={auth.username}
              onChange={(e) => update({ username: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Password">
            <SecretInput
              ariaLabel="Password"
              value={auth.password}
              onChange={(v) => update({ password: v })}
            />
          </Field>
        </div>
      )}

      {auth.type === 'api-key' && (
        <div className="flex flex-col gap-3">
          <div className={gridClass}>
            <Field id={`apikey-key-${idPrefix}`} label="Key">
              <input
                id={`apikey-key-${idPrefix}`}
                aria-label="API key name"
                value={auth.key}
                onChange={(e) => update({ key: e.target.value })}
                className={inputClass}
                placeholder="X-API-Key"
              />
            </Field>
            <Field label="Value">
              <SecretInput
                ariaLabel="API key value"
                value={auth.value}
                onChange={(v) => update({ value: v })}
              />
            </Field>
          </div>
          <Field label="Location">
            <select
              aria-label="API key location"
              value={auth.addTo}
              onChange={(e) => update({ addTo: e.target.value as 'header' | 'query' | 'cookie' })}
              className={cn(inputClass, 'max-w-xs')}
            >
              <option value="header">Header</option>
              <option value="query">Query parameter</option>
              <option value="cookie">Cookie</option>
            </select>
          </Field>
        </div>
      )}

      {auth.type === 'custom-header' && (
        <div className={gridClass}>
          <Field id={`hdr-key-${idPrefix}`} label="Header name">
            <input
              id={`hdr-key-${idPrefix}`}
              aria-label="Header name"
              value={auth.key}
              onChange={(e) => update({ key: e.target.value })}
              className={inputClass}
              placeholder="X-Auth"
            />
          </Field>
          <Field label="Header value">
            <SecretInput
              ariaLabel="Header value"
              value={auth.value}
              onChange={(v) => update({ value: v })}
            />
          </Field>
        </div>
      )}

      {auth.type === 'oauth2-client-credentials' && (
        <>
          <OAuth2Form
            auth={auth}
            onChange={update}
            fields={['tokenUrl', 'clientId', 'clientSecret', 'scope']}
            idPrefix={idPrefix}
            extra={
              <Field label="Client auth method">
                <select
                  aria-label="Client auth method"
                  value={auth.clientAuthMethod}
                  onChange={(e) =>
                    update({ clientAuthMethod: e.target.value as 'header' | 'body' })
                  }
                  className={cn(inputClass, 'max-w-xs')}
                >
                  <option value="header">Header (Basic auth)</option>
                  <option value="body">Body</option>
                </select>
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
            idPrefix={idPrefix}
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
            idPrefix={idPrefix}
            extra={
              <Field label="Code challenge method">
                <select
                  aria-label="PKCE code challenge method"
                  value={auth.codeChallengeMethod}
                  onChange={(e) =>
                    update({ codeChallengeMethod: e.target.value as 'S256' | 'plain' })
                  }
                  className={cn(inputClass, 'max-w-xs')}
                >
                  <option value="S256">S256 (recommended)</option>
                  <option value="plain">plain</option>
                </select>
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
            fields={['tokenUrl', 'clientId', 'clientSecret', 'username', 'password', 'scope']}
            idPrefix={idPrefix}
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
            idPrefix={idPrefix}
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
            idPrefix={idPrefix}
          />
          <OAuth2FlowActions auth={auth} onChange={onChange} />
        </>
      )}

      {auth.type === 'aws-sigv4' && <AwsSigV4Form auth={auth} update={update} />}
      {auth.type === 'hawk' && <HawkForm auth={auth} update={update} />}
      {auth.type === 'jwt-bearer' && <JwtBearerForm auth={auth} update={update} />}
      {auth.type === 'digest' && <DigestNtlmForm kind="digest" auth={auth} update={update} />}
      {auth.type === 'ntlm' && <DigestNtlmForm kind="ntlm" auth={auth} update={update} />}
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
  idPrefix: string;
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

function OAuth2Form<T extends OAuth2Like>({
  auth,
  onChange,
  fields,
  idPrefix,
  extra,
}: OAuth2FormProps<T>) {
  return (
    <div className="flex flex-col gap-3">
      <div className={gridClass}>
        {fields.map((field) => {
          const meta = OAUTH2_FIELD_LABELS[field as string] ?? { label: field as string };
          const id = `oauth2-${idPrefix}-${String(field)}`;
          const value = (auth[field] as unknown as string) ?? '';
          if (meta.secret) {
            return (
              <Field key={String(field)} label={meta.label}>
                <SecretInput
                  ariaLabel={meta.label}
                  value={value}
                  onChange={(v) => onChange({ [field]: v } as Partial<T>)}
                />
              </Field>
            );
          }
          return (
            <Field key={String(field)} id={id} label={meta.label}>
              <input
                id={id}
                aria-label={meta.label}
                value={value}
                placeholder={meta.placeholder}
                onChange={(e) => onChange({ [field]: e.target.value } as Partial<T>)}
                className={inputClass}
              />
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
        <input
          aria-label="AWS access key ID"
          value={auth.accessKeyId}
          onChange={(e) => update({ accessKeyId: e.target.value })}
          className={inputClass}
        />
      </Field>
      <Field label="Secret access key">
        <SecretInput
          ariaLabel="AWS secret access key"
          value={auth.secretAccessKey}
          onChange={(v) => update({ secretAccessKey: v })}
        />
      </Field>
      <Field label="Region">
        <RegionInput value={auth.region} onChange={(v) => update({ region: v })} />
      </Field>
      <Field label="Service">
        <input
          aria-label="AWS service"
          value={auth.service}
          onChange={(e) => update({ service: e.target.value })}
          className={inputClass}
          placeholder="execute-api"
        />
      </Field>
      <Field label="Session token (optional)">
        <SecretInput
          ariaLabel="AWS session token"
          value={auth.sessionToken}
          onChange={(v) => update({ sessionToken: v })}
        />
      </Field>
      <Field label="Signature location">
        <select
          aria-label="SigV4 location"
          value={auth.addTo}
          onChange={(e) => update({ addTo: e.target.value as 'header' | 'query' })}
          className={inputClass}
        >
          <option value="header">Authorization header</option>
          <option value="query">Query string (presigned)</option>
        </select>
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
        <input
          aria-label="Hawk ID"
          value={auth.hawkId}
          onChange={(e) => update({ hawkId: e.target.value })}
          className={inputClass}
        />
      </Field>
      <Field label="Hawk key">
        <SecretInput
          ariaLabel="Hawk key"
          value={auth.hawkKey}
          onChange={(v) => update({ hawkKey: v })}
        />
      </Field>
      <Field label="Algorithm">
        <select
          aria-label="Hawk algorithm"
          value={auth.algorithm}
          onChange={(e) => update({ algorithm: e.target.value as 'sha256' | 'sha1' })}
          className={inputClass}
        >
          <option value="sha256">SHA-256</option>
          <option value="sha1">SHA-1</option>
        </select>
      </Field>
      <Field label="Ext (optional)">
        <input
          aria-label="Hawk ext"
          value={auth.ext}
          onChange={(e) => update({ ext: e.target.value })}
          className={inputClass}
        />
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
          <select
            aria-label="JWT algorithm"
            value={auth.algorithm}
            onChange={(e) => update({ algorithm: e.target.value as JwtBearerAuth['algorithm'] })}
            className={inputClass}
          >
            <option value="HS256">HS256</option>
            <option value="HS384">HS384</option>
            <option value="HS512">HS512</option>
            <option value="RS256">RS256 (paste pre-signed token below)</option>
            <option value="RS384">RS384 (paste pre-signed token below)</option>
            <option value="RS512">RS512 (paste pre-signed token below)</option>
            <option value="ES256">ES256 (paste pre-signed token below)</option>
          </select>
        </Field>
        <Field label={isHs ? 'Secret (signing key)' : 'Public key (PEM, for reference)'}>
          <SecretInput
            ariaLabel="JWT signing key"
            value={auth.secretOrKey}
            onChange={(v) => update({ secretOrKey: v })}
          />
        </Field>
      </div>
      <div className={gridClass}>
        <Field label="Header overrides (JSON)">
          <JsonTextarea
            ariaLabel="JWT header"
            value={auth.jwtHeaders}
            onChange={(v) => update({ jwtHeaders: v })}
            allowEmpty
            allowRoots="object"
          />
        </Field>
        <Field label="Payload (JSON)">
          <JsonTextarea
            ariaLabel="JWT payload"
            value={auth.payload}
            onChange={(v) => update({ payload: v })}
            allowEmpty
            allowRoots="object"
          />
        </Field>
      </div>
      <Field label="Pre-computed token (optional, overrides signing)">
        <SecretInput
          ariaLabel="JWT token"
          value={auth.token}
          onChange={(v) => update({ token: v })}
          placeholder="eyJ…"
        />
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
          <input
            aria-label={`${kind} username`}
            value={auth.username}
            onChange={(e) => update({ username: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Password">
          <SecretInput
            ariaLabel={`${kind} password`}
            value={auth.password}
            onChange={(v) => update({ password: v })}
          />
        </Field>
        {kind === 'ntlm' && 'domain' in auth && (
          <>
            <Field label="Domain (optional)">
              <input
                aria-label="NTLM domain"
                value={auth.domain}
                onChange={(e) => update({ domain: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Workstation (optional)">
              <input
                aria-label="NTLM workstation"
                value={auth.workstation}
                onChange={(e) => update({ workstation: e.target.value })}
                className={inputClass}
              />
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
  ariaLabel,
  value,
  onChange,
  allowEmpty,
  allowRoots,
}: {
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

function RegionInput({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const result = validateAwsRegion(value);
  const invalid = !result.ok && value.trim().length > 0;
  return (
    <div className="flex flex-col">
      <input
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
