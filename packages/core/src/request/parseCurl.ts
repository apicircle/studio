// Parse a `curl` invocation into a partial Request shape. Handles the
// flags real-world cURL output uses (Postman/Browser/Burp/Chrome dev-tools
// "Copy as cURL"): -X / --request, -H, -d / --data / --data-raw /
// --data-binary / --data-urlencode, --json, -F (multipart), -u (basic),
// --url, and bare URL positional args. Multi-line input with `\`
// continuations is normalised first.
//
// Pure module — no UI / Monaco / fetch coupling. Returns the partial
// Request fields the editor needs (method, url, headers, body, auth)
// plus a list of unrecognised tokens so the caller can surface them.

import type { Request as ApiRequest, RequestAuth, RequestBody } from '@apicircle/shared';
import { applyContentTypeForBodyType } from './bodyTypeContentType';

export interface ParsedCurl {
  method: ApiRequest['method'];
  url: string;
  headers: ApiRequest['headers'];
  query: ApiRequest['query'];
  body: RequestBody;
  auth: RequestAuth;
  /** Unrecognised flags / fragments — the UI can show these as a warning. */
  warnings: string[];
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * Tokenise a shell-style argv from a string. Handles single/double quotes,
 * backslash escapes, and whitespace-splitting. Doesn't try to be a full
 * POSIX shell — `$VAR` expansion, command substitution, and globs all
 * pass through verbatim.
 */
export function tokenizeCurl(input: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  let i = 0;
  let quote: '"' | "'" | null = null;
  let inToken = false;

  const flush = () => {
    if (inToken) tokens.push(buf);
    buf = '';
    inToken = false;
  };

  while (i < input.length) {
    const ch = input[i];

    // Strip line continuations (`\` immediately before \n) when not in a
    // single-quoted region. Normalise CRLF to LF first via the regex below.
    if (quote !== "'" && ch === '\\' && (input[i + 1] === '\n' || input[i + 1] === undefined)) {
      i += 2;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
        inToken = true;
        i += 1;
        continue;
      }
      if (quote === '"' && ch === '\\' && i + 1 < input.length) {
        // Inside double quotes, backslash escapes the next character.
        buf += input[i + 1];
        i += 2;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
      i += 1;
      continue;
    }

    if (ch === '\\' && i + 1 < input.length) {
      buf += input[i + 1];
      inToken = true;
      i += 2;
      continue;
    }

    if (/\s/.test(ch)) {
      flush();
      i += 1;
      continue;
    }

    buf += ch;
    inToken = true;
    i += 1;
  }
  flush();
  return tokens;
}

function parseHeader(line: string): { key: string; value: string } | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  return {
    key: line.slice(0, colon).trim(),
    value: line.slice(colon + 1).trim(),
  };
}

function parseUrlEncodedBody(raw: string): { body: string; contentType: string } {
  // `--data-urlencode key=value` is sent as application/x-www-form-urlencoded.
  // Multiple --data flags concatenate with `&` — that's handled by the caller.
  return { body: raw, contentType: 'application/x-www-form-urlencoded' };
}

function detectBodyType(body: string, contentType: string): RequestBody['type'] {
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('graphql')) return 'graphql';
  if (ct.includes('form-urlencoded')) return 'urlencoded';
  // Heuristic: starts with `{` or `[` → likely JSON even if Content-Type is
  // missing (real-world Postman copy-as-cURL sometimes drops the header).
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('<')) return 'xml';
  return 'text';
}

export function parseCurl(input: string): ParsedCurl {
  // Normalise CRLF → LF and trim a leading `$ ` prompt that copy-paste
  // sometimes carries.
  const normalised = input.replace(/\r\n?/g, '\n').replace(/^\s*\$\s*/, '');
  const tokens = tokenizeCurl(normalised);

  const out: ParsedCurl = {
    method: 'GET',
    url: '',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    warnings: [],
  };

  if (tokens.length === 0) {
    out.warnings.push('Empty cURL command');
    return out;
  }
  // Skip the leading `curl` token.
  let i = tokens[0]?.toLowerCase() === 'curl' ? 1 : 0;

  // Body accumulators, kept separate so the urlencoded composer can tell a
  // field separator (`&` between `-d` fields) from a literal `&` inside a
  // `--data-urlencode` value: `-d`/`--data` flags carry `&`-separated fields
  // (curl's wire format), `--data-urlencode` carries one discrete field each,
  // `--json` is a verbatim JSON document.
  const dataFlags: string[] = [];
  const urlencodeFields: string[] = [];
  let jsonContent: string | null = null;
  let bodyContentType = '';
  let methodExplicit = false;
  const formRows: NonNullable<RequestBody['formRows']> = [];

  const consume = (): string | null => (i < tokens.length ? tokens[i++] : null);

  while (i < tokens.length) {
    const tok = tokens[i++];

    if (tok === '-X' || tok === '--request') {
      const m = consume();
      if (m && HTTP_METHODS.has(m.toUpperCase())) {
        out.method = m.toUpperCase() as ApiRequest['method'];
        methodExplicit = true;
      } else if (m) {
        out.warnings.push(`Unsupported method "${m}"`);
      }
      continue;
    }

    if (tok === '-H' || tok === '--header') {
      const v = consume();
      if (!v) continue;
      const parsed = parseHeader(v);
      if (parsed) {
        out.headers.push({ ...parsed, enabled: true });
      } else {
        out.warnings.push(`Skipped malformed header: ${v}`);
      }
      continue;
    }

    if (tok === '-d' || tok === '--data' || tok === '--data-raw' || tok === '--data-binary') {
      const v = consume();
      if (v == null) continue;
      dataFlags.push(v);
      continue;
    }

    if (tok === '--data-urlencode') {
      const v = consume();
      if (v == null) continue;
      const { body, contentType } = parseUrlEncodedBody(v);
      urlencodeFields.push(body);
      if (!bodyContentType) bodyContentType = contentType;
      continue;
    }

    if (tok === '--json') {
      const v = consume();
      if (v == null) continue;
      jsonContent = v;
      continue;
    }

    if (tok === '-F' || tok === '--form') {
      const v = consume();
      if (v == null) continue;
      const eq = v.indexOf('=');
      if (eq === -1) {
        out.warnings.push(`Skipped malformed -F: ${v}`);
        continue;
      }
      const key = v.slice(0, eq);
      const value = v.slice(eq + 1);
      // `-F field=@/path` is a file row — we can't reach the file from
      // a paste-import (no FS access in browser), so flag it as a warning
      // and add a placeholder text row keyed by file path. The user can
      // re-attach via the Form-Data UI.
      if (value.startsWith('@')) {
        out.warnings.push(
          `File field "${key}" needs manual attach — paste-import can't reach the local file (${value.slice(1)})`,
        );
        formRows.push({ kind: 'file', key, slotId: null, enabled: true });
      } else {
        formRows.push({ kind: 'text', key, value, enabled: true });
      }
      continue;
    }

    if (tok === '-u' || tok === '--user') {
      const creds = consume();
      if (!creds) continue;
      const colon = creds.indexOf(':');
      if (colon === -1) {
        out.auth = { type: 'basic', username: creds, password: '' };
      } else {
        out.auth = {
          type: 'basic',
          username: creds.slice(0, colon),
          password: creds.slice(colon + 1),
        };
      }
      continue;
    }

    if (tok === '--url') {
      const v = consume();
      if (v) out.url = v;
      continue;
    }

    if (
      tok === '--compressed' ||
      tok === '-i' ||
      tok === '--include' ||
      tok === '-s' ||
      tok === '--silent' ||
      tok === '-k' ||
      tok === '--insecure' ||
      tok === '-L' ||
      tok === '--location' ||
      tok === '--verbose' ||
      tok === '-v'
    ) {
      // Output / network flags that don't change request shape.
      continue;
    }

    if (tok === '-A' || tok === '--user-agent') {
      const v = consume();
      if (v) out.headers.push({ key: 'User-Agent', value: v, enabled: true });
      continue;
    }

    if (tok === '-e' || tok === '--referer') {
      const v = consume();
      if (v) out.headers.push({ key: 'Referer', value: v, enabled: true });
      continue;
    }

    if (tok === '-b' || tok === '--cookie') {
      const v = consume();
      if (v) out.headers.push({ key: 'Cookie', value: v, enabled: true });
      continue;
    }

    if (tok.startsWith('-')) {
      // Unrecognised flag — many cURL output flags take a value, but we
      // can't tell without a reference table. Surface it.
      out.warnings.push(`Ignored unrecognised flag: ${tok}`);
      continue;
    }

    // Bare token = URL (the first one wins; subsequent bare tokens are
    // ignored with a warning).
    if (!out.url) {
      out.url = tok;
    } else {
      out.warnings.push(`Ignored extra positional argument: ${tok}`);
    }
  }

  if (!out.url) {
    out.warnings.push('No URL found in cURL command');
  }

  // Promote method to POST when a body is present and -X wasn't given —
  // matches cURL's own default.
  if (
    !methodExplicit &&
    (jsonContent !== null ||
      dataFlags.length > 0 ||
      urlencodeFields.length > 0 ||
      formRows.length > 0)
  ) {
    out.method = 'POST';
  }

  // Split off query string from the URL into the query[] array. The editor
  // shows params separately so the user can toggle them.
  if (out.url.includes('?')) {
    const [base, qs] = out.url.split('?', 2);
    out.url = base!;
    if (qs) {
      for (const pair of qs.split('&')) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
        const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1));
        out.query.push({ key, value, enabled: true });
      }
    }
  }

  // Compose the body. For form-data: the rows are the body. For everything
  // else, refine the type from the Content-Type header (if user supplied one)
  // or the body shape.
  if (formRows.length > 0) {
    out.body = { type: 'form-data', content: '', formRows };
  } else if (jsonContent !== null) {
    out.body = { type: 'json', content: jsonContent };
    const userContentType = out.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;
    if (!userContentType) {
      out.headers = applyContentTypeForBodyType(out.headers, 'json');
    }
  } else if (dataFlags.length > 0 || urlencodeFields.length > 0) {
    const userContentType = out.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;
    const effectiveContentType = userContentType ?? bodyContentType;
    // curl's `-d` family concatenates its fields with `&` on the wire.
    const wireBody = dataFlags.join('&');
    const detectedType: RequestBody['type'] =
      urlencodeFields.length > 0 ? 'urlencoded' : detectBodyType(wireBody, effectiveContentType);
    if (detectedType === 'urlencoded') {
      // Store the raw, newline-delimited `key=value` form `composeBody`
      // expects. `-d` fields are `&`-separated on the wire; `--data-urlencode`
      // fields are already discrete and may carry a literal `&` in a value.
      const fields = [...dataFlags.flatMap((v) => v.split('&')), ...urlencodeFields].filter(
        (f) => f !== '',
      );
      out.body = { type: 'urlencoded', content: fields.join('\n') };
    } else {
      out.body = { type: detectedType, content: wireBody };
    }
    if (!userContentType) {
      // Auto-fill Content-Type so the request doesn't go out without one.
      out.headers = applyContentTypeForBodyType(out.headers, detectedType);
    }
  }

  return out;
}
