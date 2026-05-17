// Insomnia v4 export import. Translates the Insomnia "export" shape into
// the same `ParsedPostmanCollection` structure our workspace builder
// already accepts, so the importer doesn't need a second code path.
//
// Reference shape:
//   {
//     "_type": "export",
//     "__export_format": 4,
//     "resources": [
//       { "_type": "request", "_id": "req_...", "name": "...", "method": "GET",
//         "url": "https://...", "headers": [{ name, value }], "body": {...},
//         "parentId": "fld_..." | "wrk_..." },
//       { "_type": "request_group", "_id": "fld_...", "name": "Auth",
//         "parentId": "wrk_..." | "fld_..." },
//       { "_type": "workspace", "_id": "wrk_...", "name": "..." },
//       { "_type": "environment", ... }
//     ]
//   }
//
// We surface workspaces + request_groups as folders; requests as requests.
// Environments live in `insomniaEnvironment.ts`.

import type { BodyType, HttpMethod, RequestAuth, RequestBody } from '@apicircle/shared';
import type { ImportedFolder, ImportedRequest, ParsedPostmanCollection } from './postmanCollection';

const HTTP_METHODS = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

interface InsomniaResource {
  _type?: string;
  _id?: string;
  name?: string;
  parentId?: string;
  // Request fields
  method?: string;
  url?: string;
  headers?: Array<{ name?: string; value?: string; disabled?: boolean }>;
  parameters?: Array<{ name?: string; value?: string; disabled?: boolean }>;
  body?: {
    mimeType?: string;
    text?: string;
    params?: Array<{ name?: string; value?: string; disabled?: boolean; type?: string }>;
  };
  authentication?: {
    type?: string;
    token?: string;
    username?: string;
    password?: string;
    key?: string;
    value?: string;
    addTo?: string;
  };
}

interface InsomniaExport {
  _type?: string;
  __export_format?: number;
  resources?: InsomniaResource[];
}

export function isInsomniaExport(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as InsomniaExport;
  return d._type === 'export' && Array.isArray(d.resources);
}

export function parseInsomniaCollection(input: string): ParsedPostmanCollection {
  const warnings: string[] = [];
  let parsed: InsomniaExport;
  try {
    parsed = JSON.parse(input) as InsomniaExport;
  } catch (err) {
    throw new Error(`Couldn't parse JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isInsomniaExport(parsed)) {
    throw new Error(
      'Unsupported format. Expected an Insomnia export (`_type: "export"` + `resources` array). Use Insomnia → Application → Preferences → Data → Export Data.',
    );
  }
  const resources = parsed.resources ?? [];

  // Build id → resource map for parent walks.
  const byId = new Map<string, InsomniaResource>();
  for (const r of resources) if (r._id) byId.set(r._id, r);

  // The "workspace" resource is the top-level folder; we surface it as the
  // wrapper when present. Otherwise the import lands at the root.
  const workspace = resources.find((r) => r._type === 'workspace');
  const collectionName = workspace?.name?.trim() || 'Imported collection';

  // Walk-up the parent chain to compute a folder index path. Each folder
  // gets an array of indices so descendants can find their parent in the
  // post-flat structure expected by our store.
  const folders: ImportedFolder[] = [];
  const folderIndexById = new Map<string, number[]>();
  // The synthetic root has empty path; workspace's children land directly
  // inside the wrapper folder we'll create later.
  if (workspace?._id) folderIndexById.set(workspace._id, []);

  // First pass: collect folders (request_group resources), in declaration
  // order. Postman uses index paths but Insomnia is flat — we synthesize
  // the same shape.
  let folderCounter = 0;
  for (const r of resources) {
    if (r._type !== 'request_group') continue;
    const parentPath = r.parentId ? (folderIndexById.get(r.parentId) ?? null) : null;
    const ourPath = parentPath ? [...parentPath, folderCounter++] : [folderCounter++];
    folderIndexById.set(r._id ?? '', ourPath);
    folders.push({
      name: (r.name ?? 'Untitled folder').trim() || 'Untitled folder',
      pathIds: ourPath,
      parentPathIds: parentPath,
    });
  }

  // Second pass: collect requests.
  const requests: ParsedPostmanCollection['requests'] = [];
  for (const r of resources) {
    if (r._type !== 'request') continue;
    const built = buildRequest(r, warnings);
    if (!built) continue;
    const parentPath = r.parentId ? (folderIndexById.get(r.parentId) ?? null) : null;
    requests.push({ ...built, folderPathIds: parentPath });
  }

  return { collectionName, folders, requests, warnings };
}

function buildRequest(r: InsomniaResource, warnings: string[]): ImportedRequest | null {
  const method = parseMethod(r.method, warnings, r.name);
  const url = (r.url ?? '').trim();
  const headers = (r.headers ?? [])
    .filter((h): h is { name?: string; value?: string; disabled?: boolean } => Boolean(h))
    .map((h) => ({
      key: (h.name ?? '').trim(),
      value: h.value ?? '',
      enabled: !h.disabled,
    }))
    .filter((h) => h.key.length > 0);
  const query = (r.parameters ?? [])
    .filter((p): p is { name?: string; value?: string; disabled?: boolean } => Boolean(p))
    .map((p) => ({
      key: (p.name ?? '').trim(),
      value: p.value ?? '',
      enabled: !p.disabled,
    }))
    .filter((p) => p.key.length > 0);
  const body = parseBody(r.body, warnings, r.name);
  const auth = parseAuth(r.authentication, warnings, r.name);
  return {
    name: (r.name ?? 'Untitled').trim() || 'Untitled',
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

function parseBody(body: InsomniaResource['body'], warnings: string[], name?: string): RequestBody {
  if (!body || (!body.mimeType && !body.text && !body.params)) {
    return { type: 'none', content: '' };
  }
  const mime = (body.mimeType ?? '').toLowerCase();
  if (mime.includes('json')) return { type: 'json', content: body.text ?? '' };
  if (mime.includes('xml')) return { type: 'xml', content: body.text ?? '' };
  if (mime.includes('graphql')) {
    // Insomnia stores GraphQL queries as raw text under text=`{"query":"...",
    // "variables": {...}}`. Try to split.
    try {
      const obj = JSON.parse(body.text ?? '{}') as { query?: string; variables?: unknown };
      return {
        type: 'graphql',
        content: obj.query ?? '',
        variables:
          obj.variables === undefined
            ? ''
            : typeof obj.variables === 'string'
              ? obj.variables
              : JSON.stringify(obj.variables, null, 2),
      };
    } catch {
      return { type: 'graphql', content: body.text ?? '' };
    }
  }
  if (mime.includes('x-www-form-urlencoded')) {
    // `body.content` for urlencoded is raw, newline-delimited `key=value`
    // lines — `buildRequest.composeBody` percent-encodes them at send time.
    const rows = body.params ?? [];
    const content = rows
      .filter((r) => !r.disabled && (r.name ?? '').length > 0)
      .map((r) => `${r.name ?? ''}=${r.value ?? ''}`)
      .join('\n');
    return { type: 'urlencoded', content };
  }
  if (mime.includes('multipart/form-data')) {
    const rows = (body.params ?? [])
      .filter((p) => (p.name ?? '').length > 0)
      .map((p) => {
        if (p.type === 'file') {
          warnings.push(
            `Skipped form-data file row "${p.name}" on "${name ?? 'unknown'}" — re-attach the file in the editor.`,
          );
          return null;
        }
        return {
          kind: 'text' as const,
          key: p.name ?? '',
          value: p.value ?? '',
          enabled: !p.disabled,
        };
      })
      .filter(
        (r): r is { kind: 'text'; key: string; value: string; enabled: boolean } => r !== null,
      );
    return { type: 'form-data', content: '', formRows: rows };
  }
  // Anything else: treat as text body.
  const looksLikeText = body.text !== undefined;
  if (!looksLikeText) {
    warnings.push(
      `Body mime "${body.mimeType}" on "${name ?? 'unknown'}" not imported — re-attach in the editor.`,
    );
    return { type: 'binary', content: '' };
  }
  // Try to guess body type from content prefix when mime is missing/text.
  const text = body.text ?? '';
  const trimmed = text.trim();
  let type: BodyType = 'text';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) type = 'json';
  else if (trimmed.startsWith('<')) type = 'xml';
  return { type, content: text };
}

function parseAuth(
  auth: InsomniaResource['authentication'],
  warnings: string[],
  name?: string,
): RequestAuth {
  if (!auth || !auth.type) return { type: 'none' };
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: auth.token ?? '' };
    case 'basic':
      return {
        type: 'basic',
        username: auth.username ?? '',
        password: auth.password ?? '',
      };
    case 'apikey': {
      const addTo: 'header' | 'query' | 'cookie' =
        auth.addTo === 'queryParams' ? 'query' : auth.addTo === 'cookie' ? 'cookie' : 'header';
      return {
        type: 'api-key',
        key: auth.key ?? '',
        value: auth.value ?? '',
        addTo,
      };
    }
    case 'none':
      return { type: 'none' };
    default:
      warnings.push(
        `Unsupported auth type "${auth.type}" on "${name ?? 'unknown'}" — set to None. Configure manually in the editor.`,
      );
      return { type: 'none' };
  }
}
