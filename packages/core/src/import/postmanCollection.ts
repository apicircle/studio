// Postman v2.1 collection import. Translates the Postman shape into the
// minimal subset our editor knows how to render: folders + requests with
// method/url/headers/body. Auth conversion is best-effort (Bearer, Basic,
// API key); unknown auth types fall through to `{ type: 'none' }`.
//
// Reference: https://schema.postman.com/collection/json/v2.1.0/collection.json
//
// Exported `parsePostmanCollection` returns either a typed result we can hand
// to a workspace builder, or a list of warnings. We never throw on
// recoverable issues — the caller decides whether to surface them.

import type { BodyType, HttpMethod, RequestAuth, RequestBody } from '@apicircle/shared';

const POSTMAN_V2_1_SCHEMA_PATTERN = /collection\/v2(?:\.[0-9]+)*/;

export interface ImportedRequest {
  name: string;
  method: HttpMethod;
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  query: Array<{ key: string; value: string; enabled: boolean }>;
  body: RequestBody;
  auth: RequestAuth;
}

export interface ImportedFolder {
  name: string;
  /** Index path from root (deterministic id assignment is the caller's job). */
  pathIds: number[];
  parentPathIds: number[] | null;
}

export interface ParsedPostmanCollection {
  collectionName: string;
  folders: ImportedFolder[];
  requests: Array<ImportedRequest & { folderPathIds: number[] | null }>;
  warnings: string[];
}

const HTTP_METHODS = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest | string;
  auth?: PostmanAuth;
}

interface PostmanRequest {
  method?: string;
  url?: PostmanUrl | string;
  header?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  body?: PostmanBody;
  auth?: PostmanAuth;
}

interface PostmanUrl {
  raw?: string;
  host?: string[] | string;
  path?: string[] | string;
  protocol?: string;
  query?: Array<{ key?: string; value?: string; disabled?: boolean }>;
}

interface PostmanBody {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'graphql' | 'binary' | 'file';
  raw?: string;
  options?: { raw?: { language?: string } };
  urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  formdata?: Array<{ key?: string; value?: string; type?: 'text' | 'file'; disabled?: boolean }>;
  graphql?: { query?: string; variables?: string };
}

interface PostmanAuth {
  type?: string;
  bearer?: Array<{ key?: string; value?: string }>;
  basic?: Array<{ key?: string; value?: string }>;
  apikey?: Array<{ key?: string; value?: string }>;
}

interface PostmanCollectionDoc {
  info?: { name?: string; schema?: string };
  item?: PostmanItem[];
}

export function isPostmanV2Collection(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const info = (doc as PostmanCollectionDoc).info;
  if (!info || typeof info.schema !== 'string') return false;
  return POSTMAN_V2_1_SCHEMA_PATTERN.test(info.schema);
}

export function parsePostmanCollection(input: string): ParsedPostmanCollection {
  const warnings: string[] = [];
  let parsed: PostmanCollectionDoc;
  try {
    parsed = JSON.parse(input) as PostmanCollectionDoc;
  } catch (err) {
    throw new Error(`Couldn't parse JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isPostmanV2Collection(parsed)) {
    throw new Error(
      'Unsupported format. Expected a Postman v2.1 collection (info.schema must include "collection/v2"). Use Postman → Export → Collection v2.1.',
    );
  }

  const collectionName =
    (parsed.info?.name ?? 'Imported collection').trim() || 'Imported collection';
  const folders: ImportedFolder[] = [];
  const requests: ParsedPostmanCollection['requests'] = [];

  const walk = (items: PostmanItem[] | undefined, parentPathIds: number[] | null): void => {
    if (!items || items.length === 0) return;
    items.forEach((item, idx) => {
      const pathIds = parentPathIds ? [...parentPathIds, idx] : [idx];
      // Item is a folder when it has nested items.
      if (Array.isArray(item.item)) {
        folders.push({
          name: (item.name ?? 'Untitled folder').trim() || 'Untitled folder',
          pathIds,
          parentPathIds: parentPathIds,
        });
        walk(item.item, pathIds);
        return;
      }
      const built = buildRequest(item, warnings);
      if (built) requests.push({ ...built, folderPathIds: parentPathIds });
    });
  };
  walk(parsed.item, null);

  return { collectionName, folders, requests, warnings };
}

function buildRequest(item: PostmanItem, warnings: string[]): ImportedRequest | null {
  const raw = item.request;
  if (!raw) return null;
  if (typeof raw === 'string') {
    return {
      name: (item.name ?? 'Untitled').trim() || 'Untitled',
      method: 'GET',
      url: raw,
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
    };
  }
  const method = parseMethod(raw.method, warnings, item.name);
  const { url, query } = parseUrl(raw.url);
  const headers = (raw.header ?? [])
    .filter((h): h is { key?: string; value?: string; disabled?: boolean } => Boolean(h))
    .map((h) => ({
      key: (h.key ?? '').trim(),
      value: h.value ?? '',
      enabled: !h.disabled,
    }))
    .filter((h) => h.key.length > 0);
  const body = parseBody(raw.body, warnings, item.name);
  const auth = parseAuth(raw.auth ?? item.auth, warnings, item.name);
  return {
    name: (item.name ?? 'Untitled').trim() || 'Untitled',
    method,
    url,
    headers,
    query,
    body,
    auth,
  };
}

function parseMethod(method: string | undefined, warnings: string[], name?: string): HttpMethod {
  const upper = (method ?? 'GET').toUpperCase();
  if ((HTTP_METHODS as Set<string>).has(upper)) return upper as HttpMethod;
  warnings.push(`Unsupported method "${method}" on "${name ?? 'unknown'}" — defaulted to GET.`);
  return 'GET';
}

function parseUrl(url: PostmanUrl | string | undefined): {
  url: string;
  query: ImportedRequest['query'];
} {
  if (!url) return { url: '', query: [] };
  if (typeof url === 'string') return { url, query: [] };
  // Prefer .raw when present — Postman keeps the original spelling there.
  let assembled = url.raw ?? '';
  if (!assembled) {
    const proto = url.protocol ? `${url.protocol}://` : '';
    const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '');
    const path = Array.isArray(url.path) ? url.path.join('/') : (url.path ?? '').replace(/^\//, '');
    assembled = `${proto}${host}${path ? `/${path}` : ''}`;
  }
  // Strip query string from URL if both raw and structured query are present —
  // we'll re-emit query rows below from the structured list.
  const queryRows = (url.query ?? [])
    .filter((q): q is { key?: string; value?: string; disabled?: boolean } => Boolean(q))
    .map((q) => ({
      key: (q.key ?? '').trim(),
      value: q.value ?? '',
      enabled: !q.disabled,
    }))
    .filter((q) => q.key.length > 0);
  if (queryRows.length > 0 && assembled.includes('?')) {
    assembled = assembled.split('?')[0];
  }
  return { url: assembled, query: queryRows };
}

function parseBody(body: PostmanBody | undefined, warnings: string[], name?: string): RequestBody {
  if (!body || !body.mode) return { type: 'none', content: '' };
  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language ?? '';
      const type: BodyType =
        lang === 'json' ? 'json' : lang === 'xml' ? 'xml' : lang === 'graphql' ? 'graphql' : 'text';
      return { type, content: body.raw ?? '' };
    }
    case 'urlencoded': {
      // `body.content` for urlencoded is raw, newline-delimited `key=value`
      // lines — `buildRequest.composeBody` percent-encodes them at send
      // time. Encoding here would double-encode the wire body.
      const rows = body.urlencoded ?? [];
      const content = rows
        .filter((r) => !r.disabled && (r.key ?? '').length > 0)
        .map((r) => `${r.key ?? ''}=${r.value ?? ''}`)
        .join('\n');
      return { type: 'urlencoded', content };
    }
    case 'graphql': {
      return {
        type: 'graphql',
        content: body.graphql?.query ?? '',
        variables: body.graphql?.variables ?? '',
      };
    }
    case 'formdata': {
      // Form-data file rows can't round-trip without the actual file blob —
      // we drop them here with a warning. Text rows survive as form rows.
      const rows = (body.formdata ?? [])
        .filter((r) => (r.key ?? '').length > 0)
        .map((r) => {
          if (r.type === 'file') {
            warnings.push(
              `Skipped form-data file row "${r.key}" on "${name ?? 'unknown'}" — re-attach the file in the editor.`,
            );
            return null;
          }
          return {
            kind: 'text' as const,
            key: r.key ?? '',
            value: r.value ?? '',
            enabled: !r.disabled,
          };
        })
        .filter(
          (r): r is { kind: 'text'; key: string; value: string; enabled: boolean } => r !== null,
        );
      return { type: 'form-data', content: '', formRows: rows };
    }
    case 'binary':
    case 'file': {
      warnings.push(
        `Binary body on "${name ?? 'unknown'}" not imported — re-attach the file in the editor.`,
      );
      return { type: 'binary', content: '' };
    }
    default:
      warnings.push(
        `Unsupported body mode "${String((body as { mode: unknown }).mode)}" on "${name ?? 'unknown'}" — body skipped.`,
      );
      return { type: 'none', content: '' };
  }
}

function parseAuth(auth: PostmanAuth | undefined, warnings: string[], name?: string): RequestAuth {
  if (!auth || !auth.type) return { type: 'none' };
  const valueOf = (
    rows: Array<{ key?: string; value?: string }> | undefined,
    key: string,
  ): string => {
    const found = rows?.find((r) => r.key === key);
    return (found?.value ?? '').toString();
  };
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: valueOf(auth.bearer, 'token') };
    case 'basic':
      return {
        type: 'basic',
        username: valueOf(auth.basic, 'username'),
        password: valueOf(auth.basic, 'password'),
      };
    case 'apikey': {
      const inLocation = (valueOf(auth.apikey, 'in') || 'header').toLowerCase();
      const addTo: 'header' | 'query' | 'cookie' =
        inLocation === 'query' ? 'query' : inLocation === 'cookie' ? 'cookie' : 'header';
      return {
        type: 'api-key',
        key: valueOf(auth.apikey, 'key'),
        value: valueOf(auth.apikey, 'value'),
        addTo,
      };
    }
    case 'noauth':
      return { type: 'none' };
    default:
      warnings.push(
        `Unsupported auth type "${auth.type}" on "${name ?? 'unknown'}" — set to None. Configure manually in the editor.`,
      );
      return { type: 'none' };
  }
}
