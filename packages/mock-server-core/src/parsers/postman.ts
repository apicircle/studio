// Postman v2.1 collection → MockEndpoint[].
//
// Postman's collection JSON has a recursive `item[]` structure where each
// item is either:
//   • a folder: `{ name, item: [...] }`
//   • a request: `{ name, request: {...}, response?: [...] }`
//
// For mocking, the most useful payload is `response[]` — Postman lets
// users save example responses against each request. We pull the first
// response from each request that has any. When a request has no saved
// example, we synthesize a 200 with an empty JSON body.

import type { HttpMethod, MockEndpoint } from '@apicircle/shared';
import { buildMockEndpoint } from './buildEndpoint';

interface PostmanCollection {
  info?: { name?: string; schema?: string };
  item?: PostmanItem[];
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[]; // folder
  request?: PostmanRequest;
  response?: PostmanResponse[];
}

interface PostmanRequest {
  method?: string;
  url?: string | { raw?: string; path?: string[] | string };
  header?: Array<{ key: string; value: string }>;
  body?: { raw?: string; mode?: string };
}

interface PostmanResponse {
  name?: string;
  status?: string;
  code?: number;
  header?: Array<{ key: string; value: string }>;
  body?: string;
  _postman_previewlanguage?: string;
}

const SUPPORTED_METHODS: ReadonlyArray<HttpMethod> = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

export interface ParsePostmanResult {
  endpoints: MockEndpoint[];
  warnings: string[];
}

export function parsePostmanToEndpoints(source: string): ParsePostmanResult {
  const warnings: string[] = [];
  let parsed: PostmanCollection;
  try {
    parsed = JSON.parse(source) as PostmanCollection;
  } catch {
    return { endpoints: [], warnings: ['Could not parse Postman collection JSON'] };
  }

  const endpoints: MockEndpoint[] = [];
  let endpointId = 0;
  walkItems(parsed.item ?? [], (item) => {
    if (!item.request) return;
    const method = (item.request.method ?? 'GET').toUpperCase() as HttpMethod;
    if (!SUPPORTED_METHODS.includes(method)) {
      warnings.push(`Skipping ${method} (unsupported method): ${item.name ?? '(unnamed)'}`);
      return;
    }
    const path = extractPath(item.request.url);
    if (!path) {
      warnings.push(`Skipping request with no extractable path: ${item.name ?? '(unnamed)'}`);
      return;
    }

    // First saved response wins. Postman stores examples in
    // `response[]` — a request without saved examples falls through to
    // the synthesized default below.
    const example = item.response?.[0];
    if (example) {
      endpoints.push(
        buildMockEndpoint({
          id: `pm-${endpointId++}-${slug(path)}`,
          name: item.name,
          method,
          pathPattern: path,
          example: example.name,
          response: {
            // Postman's `code` is the canonical numeric status; `status` is a
            // human-readable label that *sometimes* parses as a number. Try
            // both, fall back to 200 only when neither yields a finite number.
            status:
              example.code ??
              (Number.isFinite(Number(example.status)) ? Number(example.status) : 200),
            headers: (example.header ?? []).map((h) => ({ key: h.key, value: h.value })),
            body: example.body ?? '',
          },
        }),
      );
    } else {
      endpoints.push(
        buildMockEndpoint({
          id: `pm-${endpointId++}-${slug(path)}`,
          name: item.name,
          method,
          pathPattern: path,
          response: {
            status: 200,
            headers: [{ key: 'Content-Type', value: 'application/json' }],
            body: '{}',
          },
        }),
      );
    }
  });

  return { endpoints, warnings };
}

function walkItems(items: PostmanItem[], visit: (item: PostmanItem) => void): void {
  for (const item of items) {
    if (item.item) walkItems(item.item, visit);
    else if (item.request) visit(item);
  }
}

function extractPath(url: PostmanRequest['url']): string | null {
  if (!url) return null;
  if (typeof url === 'string') {
    return urlToPath(url);
  }
  if (url.raw) return urlToPath(url.raw);
  if (url.path) {
    const segments = Array.isArray(url.path) ? url.path : [url.path];
    return '/' + segments.filter(Boolean).join('/');
  }
  return null;
}

function urlToPath(raw: string): string | null {
  // Postman often stores absolute URLs (e.g. https://api.example.com/users).
  // The mock server cares about the path only.
  try {
    const parsed = new URL(raw.replace(/^https?:\/\/[^/]*$/, raw + '/'));
    return parsed.pathname || '/';
  } catch {
    // Already a path or a template like {{baseUrl}}/users.
    const idx = raw.indexOf('/');
    return idx === -1 ? '/' : raw.slice(idx);
  }
}

function slug(s: string): string {
  return (
    s
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'root'
  );
}
