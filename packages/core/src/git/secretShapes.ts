// What a secret LOOKS like — the rules behind `scanWorkspaceForSecrets` and the
// URL half of `redactForGit`. Pure string heuristics, no workspace knowledge.
//
// Every check here is linear in the length of what it reads, so a hostile
// workspace value cannot turn a scan into a hang: values are split into tokens
// first and each credential format is matched ANCHORED at a token's start (an
// unanchored `eyJ…\.` scan restarts at every position and backtracks over the
// rest of the text each time).

/** `{{variable}}` references — resolved at send time, never secrets themselves. */
const TEMPLATE = /\{\{[^}]*\}\}/g;

/** A leading auth scheme word, which is protocol, not credential. */
const AUTH_SCHEME =
  /^(?:bearer|basic|token|digest|bot|apikey|api-key|hawk|negotiate|ntlm|dpop|aws4-hmac-sha256)\s*/i;

/** Values that stand in for a credential rather than being one. */
const PLACEHOLDER = /^(?:<[^>]*>|\[[^\]]*\]|x+|\*+|\.+|-+|_+|(?:your|my)[\s_-].*)$/i;

/** A value made only of these words (`demo-bearer-token`, `your-api-key-here`,
 *  `changeme`) is a placeholder, whatever it is called. */
const PLACEHOLDER_WORDS: ReadonlySet<string> = new Set([
  'a',
  'access',
  'api',
  'auth',
  'bar',
  'baz',
  'bearer',
  'change',
  'changeme',
  'demo',
  'dev',
  'dummy',
  'example',
  'fake',
  'foo',
  'here',
  'insert',
  'key',
  'local',
  'me',
  'mock',
  'my',
  'none',
  'null',
  'pass',
  'password',
  'placeholder',
  'put',
  'redacted',
  'replace',
  'sample',
  'secret',
  'string',
  'tbd',
  'test',
  'testing',
  'the',
  'todo',
  'token',
  'undefined',
  'value',
  'your',
]);

/** The last word of a name that describes a credential rather than holding one
 *  (`token_url`, `session_timeout`, `password_policy`, `api_key_header`). */
const METADATA_WORDS: ReadonlySet<string> = new Set([
  'url',
  'uri',
  'endpoint',
  'path',
  'host',
  'hostname',
  'domain',
  'type',
  'name',
  'header',
  'param',
  'field',
  'length',
  'timeout',
  'ttl',
  'expiry',
  'expires',
  'expiration',
  'prefix',
  'label',
  'scope',
  'scopes',
  'version',
  'format',
  'count',
  'enabled',
  'required',
  'mode',
  'method',
  'policy',
  'location',
  'file',
  'dir',
  'hint',
  'kind',
]);

/** Words that turn a following `key` into a credential (`x_api_key`,
 *  `subscription_key`, `private_key`) — unlike `idempotency_key` or `sort_key`. */
const KEY_QUALIFIERS: ReadonlySet<string> = new Set([
  'api',
  'access',
  'private',
  'secret',
  'signing',
  'master',
  'encryption',
  'subscription',
  'app',
  'application',
  'client',
  'functions',
  'auth',
  'license',
  'account',
  'service',
  'admin',
  'security',
  'shared',
]);

/** Single words that name a credential or a session on their own. */
const CREDENTIAL_WORDS: ReadonlySet<string> = new Set([
  'pwd',
  'auth',
  'bearer',
  'jwt',
  'sid',
  'sess',
  'session',
  'sessionid',
  'sessid',
  'phpsessid',
  'jsessionid',
]);

/** Pagination and sync handles are named "token" but grant nothing. */
const HANDLE_TOKEN =
  /(?:^|_)(?:page|next_page|next|continuation|sync|cursor|pagination|resume)_token$/;

/** Known credential formats, matched at the START of a token (see the module
 *  header for why they are anchored). */
const KNOWN_FORMATS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^gh[pousr]_[A-Za-z0-9]{36}/, 'looks like a GitHub token'],
  [/^github_pat_[A-Za-z0-9_]{22}/, 'looks like a GitHub token'],
  [/^glpat-[A-Za-z0-9_-]{20}/, 'looks like a GitLab token'],
  [/^xox[abposr]-[A-Za-z0-9-]{10}/, 'looks like a Slack token'],
  [/^xapp-[A-Za-z0-9-]{10}/, 'looks like a Slack token'],
  [/^[sr]k_(?:live|test)_[A-Za-z0-9]{16}/, 'looks like a Stripe secret key'],
  [/^whsec_[A-Za-z0-9+/]{16}/, 'looks like a webhook signing secret'],
  [/^sk-[A-Za-z0-9_-]{20}/, 'looks like an API secret key'],
  [/^(?:AKIA|ASIA)[0-9A-Z]{16}$/, 'looks like an AWS access key'],
  [/^AIza[0-9A-Za-z_-]{35}/, 'looks like a Google API key'],
  [/^npm_[A-Za-z0-9]{36}/, 'looks like an npm token'],
  [/^SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16}/, 'looks like a SendGrid API key'],
  [/^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./, 'looks like a JSON Web Token'],
];

/** `value` with every `{{variable}}` reference removed and the ends trimmed:
 *  the part that is written into the workspace as-is. */
export function literalPart(value: string): string {
  return value.replace(TEMPLATE, '').trim();
}

/** `Authorization`, `apiKey`, `X-API-Key` and `x_api_key` all normalise to
 *  lowercase words joined by `_`. */
function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * Whether `name` is the name of a credential: `Authorization`, anything with
 * `token`, `secret`, `passw…` or `credential` in it, `Cookie` / `Set-Cookie`,
 * `api_key` and other qualified keys, a bare `key`, and session cookie names
 * (`session`, `sid`, `JSESSIONID`, `connect.sid`, …). A name that describes a
 * credential instead of holding one (`token_url`, `session_timeout`) and a
 * pagination handle (`page_token`) are not.
 */
export function isCredentialName(name: string): boolean {
  const words = nameWords(name);
  if (words.length === 0) return false;
  if (words.length > 1 && METADATA_WORDS.has(words[words.length - 1])) return false;
  const joined = words.join('_');
  if (HANDLE_TOKEN.test(joined)) return false;
  if (joined === 'key') return true;
  if (/authorization|token|secret|passw|credential|cookie|apikey/.test(joined)) return true;
  return words.some(
    (word, i) =>
      CREDENTIAL_WORDS.has(word) || (word === 'key' && i > 0 && KEY_QUALIFIERS.has(words[i - 1])),
  );
}

/**
 * Whether `value` holds something that could be a credential: text that is
 * still there once `{{variables}}` and a leading auth scheme word are removed,
 * at least four characters long, and not a number, a boolean or an obvious
 * placeholder (`<token>`, `YOUR_API_KEY`, `xxxx`, `demo-bearer-token`).
 */
export function carriesLiteral(value: string): boolean {
  const literal = literalPart(value).replace(AUTH_SCHEME, '').trim();
  if (literal.length < 4) return false;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(literal)) return false;
  if (/^(?:true|false|yes|no|on|off)$/i.test(literal)) return false;
  if (PLACEHOLDER.test(literal)) return false;
  return !literal
    .toLowerCase()
    .split(/[\s_.-]+/)
    .filter((word) => word.length > 0)
    .every((word) => PLACEHOLDER_WORDS.has(word));
}

/** Bits of entropy per character. */
function shannonEntropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** The share of `word` spelled in runs of four or more lowercase letters —
 *  high for identifiers (`getUserProfile…`), near zero for generated keys. */
function lowercaseWordShare(word: string): number {
  let letters = 0;
  for (const run of word.match(/[a-z]{4,}/g) ?? []) letters += run.length;
  return letters / word.length;
}

/** A long run of mixed-case letters and digits with high entropy and no
 *  words in it — the shape of a generated key. Hex digests, UUIDs, camel-case
 *  identifiers and paths don't qualify. */
function looksRandom(word: string): boolean {
  if (word.length < 32) return false;
  if (!/^[A-Za-z0-9+/=_.~-]+$/.test(word)) return false;
  if (!/[a-z]/.test(word) || !/[A-Z]/.test(word) || !/[0-9]/.test(word)) return false;
  // More than two slashes is a path, not base64.
  if (word.split('/').length > 3) return false;
  return shannonEntropy(word) >= 4.2 && lowercaseWordShare(word) < 0.3;
}

/**
 * Why `value` holds a credential in a format we recognise — a GitHub, GitLab,
 * Slack, Stripe, AWS, Google, npm or SendGrid token, an `sk-…` API key, a JSON
 * Web Token, a PEM private key — or `null`. Only the literal part is judged.
 */
export function secretFormatReason(value: string): string | null {
  const literal = literalPart(value);
  if (literal.includes('PRIVATE KEY-----')) return 'contains a private key';
  for (const token of literal.split(/[^A-Za-z0-9_.+/~-]+/)) {
    for (const [pattern, reason] of KNOWN_FORMATS) {
      if (pattern.test(token)) return reason;
    }
  }
  return null;
}

/**
 * Why `value` looks like a secret whatever it is called — a known credential
 * format, or a random-looking key — or `null`. Only the literal part is
 * judged: `{{variables}}` are references, not values.
 */
export function secretValueReason(value: string): string | null {
  const byFormat = secretFormatReason(value);
  if (byFormat) return byFormat;
  for (const piece of literalPart(value).split(/[\s;,&]+/)) {
    const eq = piece.indexOf('=');
    if (looksRandom(piece) || (eq > 0 && looksRandom(piece.slice(eq + 1)))) {
      return 'looks like a randomly generated secret';
    }
  }
  return null;
}

/**
 * Why a `name: value` row looks like a secret, or `null`. The value's own
 * shape is the more specific answer; failing that, a credential name with a
 * literal value.
 */
export function secretRowReason(name: string, value: string): string | null {
  const byValue = secretValueReason(value);
  if (byValue) return byValue;
  return isCredentialName(name) && carriesLiteral(value) ? 'named like a credential' : null;
}

/**
 * The user-info (`user:pass`) of an absolute URL, located on the raw string so
 * `{{variables}}` elsewhere in it survive untouched. As in the WHATWG URL
 * parser, the authority ends at the first `/`, `?` or `#`, and the LAST `@`
 * inside it ends the user-info.
 */
export function urlUserinfo(url: string): { userinfo: string; start: number; end: number } | null {
  const match = /^\s*[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(url);
  if (!match) return null;
  const authority = match[1];
  const at = authority.lastIndexOf('@');
  if (at < 0) return null;
  const start = match[0].length - authority.length;
  return { userinfo: authority.slice(0, at), start, end: start + at + 1 };
}

function tryDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Why a URL's user-info would leak a credential, or `null`: it carries a
 * literal password (`user:pass@`), or a user name shaped like a token
 * (`https://ghp_…@github.com`). A plain user name, or user-info made only of
 * `{{variables}}`, is not a credential.
 */
export function userinfoReason(userinfo: string): string | null {
  const colon = userinfo.indexOf(':');
  const user = colon < 0 ? userinfo : userinfo.slice(0, colon);
  const password = colon < 0 ? '' : userinfo.slice(colon + 1);
  if (literalPart(password).length > 0) return 'carries a password';
  return secretValueReason(tryDecode(user));
}

/** `url` without user-info that would leak a credential (see
 *  {@link userinfoReason}); any other URL comes back unchanged. */
export function stripUrlCredentials(url: string): string {
  const info = urlUserinfo(url);
  if (!info || userinfoReason(info.userinfo) === null) return url;
  return url.slice(0, info.start) + url.slice(info.end);
}

/** The `key=value` pairs of a URL's query string, decoded. */
export function urlQueryPairs(url: string): Array<{ key: string; value: string }> {
  const q = url.indexOf('?');
  if (q < 0) return [];
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash < 0 ? undefined : hash);
  if (query.length === 0) return [];
  return query.split('&').map((segment) => {
    const eq = segment.indexOf('=');
    return {
      key: tryDecode(eq < 0 ? segment : segment.slice(0, eq)),
      value: tryDecode(eq < 0 ? '' : segment.slice(eq + 1)),
    };
  });
}
