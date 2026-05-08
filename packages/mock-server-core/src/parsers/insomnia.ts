// Insomnia v4 export → MockEndpoint[].
//
// Insomnia's export format is a flat `resources[]` array where each entry
// has a `_type` discriminator (`request`, `request_group`, `environment`,
// `workspace`). We only consume `_type === 'request'`.
//
// Insomnia doesn't ship saved-response examples, so every endpoint gets a
// synthesized 200 with an empty JSON body. The user can override per-
// endpoint via the editor.

import type { HttpMethod, MockEndpoint } from '@apicircle/shared';
import { buildMockEndpoint } from './buildEndpoint';

interface InsomniaExport {
  resources?: InsomniaResource[];
}

interface InsomniaResource {
  _id?: string;
  _type?: string;
  name?: string;
  method?: string;
  url?: string;
  parentId?: string;
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

export interface ParseInsomniaResult {
  endpoints: MockEndpoint[];
  warnings: string[];
}

export function parseInsomniaToEndpoints(source: string): ParseInsomniaResult {
  const warnings: string[] = [];
  let parsed: InsomniaExport;
  try {
    parsed = JSON.parse(source) as InsomniaExport;
  } catch {
    return { endpoints: [], warnings: ['Could not parse Insomnia export JSON'] };
  }

  const endpoints: MockEndpoint[] = [];
  let endpointId = 0;

  for (const r of parsed.resources ?? []) {
    if (r._type !== 'request') continue;
    const method = (r.method ?? 'GET').toUpperCase() as HttpMethod;
    if (!SUPPORTED_METHODS.includes(method)) {
      warnings.push(`Skipping ${method} (unsupported method): ${r.name ?? '(unnamed)'}`);
      continue;
    }
    const path = extractPath(r.url);
    if (!path) {
      warnings.push(`Skipping request with no path: ${r.name ?? '(unnamed)'}`);
      continue;
    }
    endpoints.push(
      buildMockEndpoint({
        id: `ins-${endpointId++}-${slug(path)}`,
        name: r.name,
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

  return { endpoints, warnings };
}

function extractPath(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname || '/';
  } catch {
    const idx = url.indexOf('/');
    return idx === -1 ? '/' : url.slice(idx);
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
