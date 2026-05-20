import { z } from 'zod';
import type { Request as ApiRequest } from '@apicircle/shared';
import { generateId } from '@apicircle/shared';
import { parseCurl } from '@apicircle/core';
import {
  parseOpenApiToEndpoints,
  parsePostmanToEndpoints,
  parseInsomniaToEndpoints,
} from '@apicircle/mock-server-core';
import type { AnyToolDef } from './types';

// =============================================================================
// Import tools — convert external request descriptions into one or more
// requests in the workspace. Each tool persists to the workspace and returns
// the created request ids so the AI client can reference them in follow-up
// turns.
// =============================================================================

const FALLBACK_NAME = (idx: number, fallback: string): string =>
  fallback || `Imported request ${idx + 1}`;

function blankRequest(): Omit<ApiRequest, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Imported request',
    folderId: null,
    method: 'GET',
    url: '',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
  };
}

export const importCurlTool: AnyToolDef = {
  name: 'import.curl',
  description: 'Parse a `curl ...` command into a Request and persist it to the workspace.',
  inputSchema: z.object({
    curl: z.string().min(1, 'curl command is required'),
    name: z.string().optional(),
    folderId: z.string().nullable().optional(),
  }),
  async handler(input, ctx) {
    const parsed = parseCurl(input.curl);
    const now = new Date().toISOString();
    const request: ApiRequest = {
      ...blankRequest(),
      id: generateId(),
      name: input.name?.trim() || `cURL ${parsed.method} ${parsed.url}`.slice(0, 80),
      method: parsed.method,
      url: parsed.url,
      headers: parsed.headers,
      query: parsed.query,
      body: parsed.body,
      auth: parsed.auth,
      folderId: input.folderId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const out = await ctx.workspace.apply({ kind: 'request.create', request });
    return {
      id: request.id,
      warnings: parsed.warnings,
      changedIds: out.changedIds,
    };
  },
};

export const importOpenApiTool: AnyToolDef = {
  name: 'import.openapi',
  description:
    'Parse an OpenAPI / Swagger spec (YAML or JSON) and create one Request per operation. Returns the list of created request ids.',
  inputSchema: z.object({
    spec: z.string().min(1),
    format: z.enum(['json', 'yaml']).default('json'),
    folderId: z.string().nullable().optional(),
  }),
  async handler(input, ctx) {
    const parsed = await parseOpenApiToEndpoints(input.spec, input.format);
    const ids: string[] = [];
    for (let i = 0; i < parsed.endpoints.length; i++) {
      const ep = parsed.endpoints[i];
      const now = new Date().toISOString();
      const req: ApiRequest = {
        ...blankRequest(),
        id: generateId(),
        name: FALLBACK_NAME(i, ep.example ?? `${ep.method} ${ep.pathPattern}`),
        method: ep.method,
        url: ep.pathPattern,
        folderId: input.folderId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.workspace.apply({ kind: 'request.create', request: req });
      ids.push(req.id);
    }
    return { createdIds: ids, warnings: parsed.warnings };
  },
};

export const importPostmanTool: AnyToolDef = {
  name: 'import.postman',
  description: 'Parse a Postman v2/v2.1 collection JSON and create one Request per item.',
  inputSchema: z.object({
    collection: z.string().min(1),
    folderId: z.string().nullable().optional(),
  }),
  async handler(input, ctx) {
    const parsed = parsePostmanToEndpoints(input.collection);
    const ids: string[] = [];
    for (let i = 0; i < parsed.endpoints.length; i++) {
      const ep = parsed.endpoints[i];
      const now = new Date().toISOString();
      const req: ApiRequest = {
        ...blankRequest(),
        id: generateId(),
        name: FALLBACK_NAME(i, ep.example ?? `${ep.method} ${ep.pathPattern}`),
        method: ep.method,
        url: ep.pathPattern,
        folderId: input.folderId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.workspace.apply({ kind: 'request.create', request: req });
      ids.push(req.id);
    }
    return { createdIds: ids, warnings: parsed.warnings };
  },
};

export const importInsomniaTool: AnyToolDef = {
  name: 'import.insomnia',
  description: 'Parse an Insomnia v4 export and create one Request per resource of type "request".',
  inputSchema: z.object({
    export: z.string().min(1),
    folderId: z.string().nullable().optional(),
  }),
  async handler(input, ctx) {
    const parsed = parseInsomniaToEndpoints(input.export);
    const ids: string[] = [];
    for (let i = 0; i < parsed.endpoints.length; i++) {
      const ep = parsed.endpoints[i];
      const now = new Date().toISOString();
      const req: ApiRequest = {
        ...blankRequest(),
        id: generateId(),
        name: FALLBACK_NAME(i, ep.example ?? `${ep.method} ${ep.pathPattern}`),
        method: ep.method,
        url: ep.pathPattern,
        folderId: input.folderId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.workspace.apply({ kind: 'request.create', request: req });
      ids.push(req.id);
    }
    return { createdIds: ids, warnings: parsed.warnings };
  },
};

// HAR — quick adapter. We extract method/url/headers/body from `log.entries[].request`.
export const importHarTool: AnyToolDef = {
  name: 'import.har',
  description:
    'Parse an HTTP Archive (.har) JSON and create one Request per recorded entry. Cookies, response, and timings are dropped.',
  inputSchema: z.object({
    har: z.string().min(1),
    folderId: z.string().nullable().optional(),
  }),
  async handler(input, ctx) {
    let parsed: {
      log?: { entries?: Array<{ request?: HarRequest }> };
    };
    try {
      parsed = JSON.parse(input.har);
    } catch (err) {
      return { createdIds: [], warnings: [`HAR parse error: ${(err as Error).message}`] };
    }
    const entries = parsed.log?.entries ?? [];
    const ids: string[] = [];
    const warnings: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i].request;
      if (!e || !e.url || !e.method) {
        warnings.push(`Entry #${i} missing method/url; skipped`);
        continue;
      }
      const url = new URL(e.url);
      const now = new Date().toISOString();
      const req: ApiRequest = {
        ...blankRequest(),
        id: generateId(),
        name: `${e.method} ${url.pathname}`,
        method: e.method as ApiRequest['method'],
        url: e.url,
        headers: (e.headers ?? []).map((h) => ({
          key: h.name,
          value: h.value,
          enabled: true,
        })),
        query: (e.queryString ?? []).map((q) => ({
          key: q.name,
          value: q.value,
          enabled: true,
        })),
        body: e.postData
          ? { type: 'text', content: e.postData.text ?? '' }
          : { type: 'none', content: '' },
        folderId: input.folderId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.workspace.apply({ kind: 'request.create', request: req });
      ids.push(req.id);
    }
    return { createdIds: ids, warnings };
  },
};

interface HarRequest {
  method?: string;
  url?: string;
  headers?: Array<{ name: string; value: string }>;
  queryString?: Array<{ name: string; value: string }>;
  postData?: { text?: string; mimeType?: string };
}
