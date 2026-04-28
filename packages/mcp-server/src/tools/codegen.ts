import { z } from 'zod';
import type { Request as ApiRequest } from '@apicircle/shared';
import type { AnyToolDef } from './types';

// =============================================================================
// generate.code — produce a code snippet that reproduces a workspace request
// in the user's language of choice. Targets are intentionally hand-rolled
// rather than delegating to a third-party codegen lib so output stays small,
// reviewable, and free from heavy transitive deps.
// =============================================================================

const TARGET = z.enum(['curl', 'fetch', 'node-axios', 'python-requests', 'go', 'rust']);

export const generateCodeTool: AnyToolDef = {
  name: 'generate.code',
  description:
    'Generate runnable code (curl / JavaScript fetch / Node Axios / Python requests / Go net/http / Rust reqwest) that reproduces a workspace request.',
  inputSchema: z.object({
    requestId: z.string(),
    target: TARGET,
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const req = state.synced.collections.requests[input.requestId];
    if (!req) return { ok: false, error: 'request not found' };
    const code = renderCode(req, input.target);
    return { ok: true, target: input.target, code };
  },
};

function renderCode(req: ApiRequest, target: z.infer<typeof TARGET>): string {
  switch (target) {
    case 'curl':
      return renderCurl(req);
    case 'fetch':
      return renderFetch(req);
    case 'node-axios':
      return renderAxios(req);
    case 'python-requests':
      return renderPython(req);
    case 'go':
      return renderGo(req);
    case 'rust':
      return renderRust(req);
  }
}

function fullUrl(req: ApiRequest): string {
  if (!req.query.length) return req.url;
  const enabled = req.query.filter((q) => q.enabled !== false);
  if (!enabled.length) return req.url;
  const sep = req.url.includes('?') ? '&' : '?';
  return (
    req.url +
    sep +
    enabled.map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`).join('&')
  );
}

function bodyContent(req: ApiRequest): string | null {
  if (req.body.type === 'none') return null;
  if (req.body.type === 'json' || req.body.type === 'text' || req.body.type === 'xml') {
    return req.body.content;
  }
  if (req.body.type === 'graphql') {
    return JSON.stringify({ query: req.body.content, variables: req.body.variables ?? null });
  }
  if (req.body.type === 'urlencoded') return req.body.content;
  return null;
}

function renderCurl(req: ApiRequest): string {
  const parts: string[] = [`curl -X ${req.method} '${fullUrl(req)}'`];
  for (const h of req.headers.filter((x) => x.enabled !== false)) {
    parts.push(`-H '${h.key}: ${h.value}'`);
  }
  const body = bodyContent(req);
  if (body !== null) {
    parts.push(`--data-raw '${body.replace(/'/g, "'\\''")}'`);
  }
  return parts.join(' \\\n  ');
}

function renderFetch(req: ApiRequest): string {
  const headers = Object.fromEntries(
    req.headers.filter((h) => h.enabled !== false).map((h) => [h.key, h.value]),
  );
  const body = bodyContent(req);
  const init: Record<string, unknown> = { method: req.method };
  if (Object.keys(headers).length) init.headers = headers;
  if (body !== null) init.body = body;
  return `await fetch(${JSON.stringify(fullUrl(req))}, ${JSON.stringify(init, null, 2)})`;
}

function renderAxios(req: ApiRequest): string {
  const config: Record<string, unknown> = {
    method: req.method.toLowerCase(),
    url: fullUrl(req),
  };
  const headers = req.headers.filter((h) => h.enabled !== false);
  if (headers.length) config.headers = Object.fromEntries(headers.map((h) => [h.key, h.value]));
  const body = bodyContent(req);
  if (body !== null) config.data = body;
  return `import axios from 'axios';\n\nconst response = await axios(${JSON.stringify(
    config,
    null,
    2,
  )});`;
}

function renderPython(req: ApiRequest): string {
  const headers = req.headers.filter((h) => h.enabled !== false);
  const body = bodyContent(req);
  const lines: string[] = ['import requests', ''];
  lines.push(`response = requests.request(`);
  lines.push(`    method=${JSON.stringify(req.method)},`);
  lines.push(`    url=${JSON.stringify(fullUrl(req))},`);
  if (headers.length) {
    lines.push(
      `    headers=${JSON.stringify(Object.fromEntries(headers.map((h) => [h.key, h.value])))},`,
    );
  }
  if (body !== null) lines.push(`    data=${JSON.stringify(body)},`);
  lines.push(')');
  return lines.join('\n');
}

function renderGo(req: ApiRequest): string {
  const headers = req.headers.filter((h) => h.enabled !== false);
  const body = bodyContent(req);
  const lines: string[] = [
    'package main',
    '',
    'import (',
    '    "io"',
    '    "net/http"',
    '    "strings"',
    ')',
    '',
    'func main() {',
  ];
  if (body !== null) {
    lines.push(`    body := strings.NewReader(${JSON.stringify(body)})`);
    lines.push(
      `    req, _ := http.NewRequest(${JSON.stringify(req.method)}, ${JSON.stringify(fullUrl(req))}, body)`,
    );
  } else {
    lines.push(
      `    req, _ := http.NewRequest(${JSON.stringify(req.method)}, ${JSON.stringify(fullUrl(req))}, nil)`,
    );
  }
  for (const h of headers) {
    lines.push(`    req.Header.Set(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)})`);
  }
  lines.push('    resp, _ := http.DefaultClient.Do(req)');
  lines.push('    defer resp.Body.Close()');
  lines.push('    out, _ := io.ReadAll(resp.Body)');
  lines.push('    _ = out');
  lines.push('}');
  return lines.join('\n');
}

function renderRust(req: ApiRequest): string {
  const headers = req.headers.filter((h) => h.enabled !== false);
  const body = bodyContent(req);
  const lines: string[] = [
    'use reqwest::Client;',
    '',
    '#[tokio::main]',
    'async fn main() -> Result<(), Box<dyn std::error::Error>> {',
    `    let client = Client::new();`,
    `    let mut req = client.request(reqwest::Method::${req.method}, ${JSON.stringify(
      fullUrl(req),
    )});`,
  ];
  for (const h of headers) {
    lines.push(`    req = req.header(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)});`);
  }
  if (body !== null) lines.push(`    req = req.body(${JSON.stringify(body)});`);
  lines.push('    let _resp = req.send().await?;');
  lines.push('    Ok(())');
  lines.push('}');
  return lines.join('\n');
}
