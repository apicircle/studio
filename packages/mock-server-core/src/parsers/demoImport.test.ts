import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSourceToEndpoints as parseNode } from '../index';
import { parseSourceToEndpoints as parseBrowser } from '../parsing';

// Integration guard: the shipped demo OpenAPI (used by the "swagger-first"
// showcase + the Web/Desktop mock-import walkthrough) must import cleanly on
// BOTH parse paths — the Node root (swagger-parser, used by Desktop main / CLI
// / MCP) and the browser `/parsing` entry (in-document resolver, used by the
// Web app). It leans entirely on in-document `$ref`s, so the browser path must
// resolve everything with ZERO external-ref warnings.

const here = dirname(fileURLToPath(import.meta.url));
const demoPath = resolve(here, '../../../../examples/swagger-first/apicircle-demo-openapi.yaml');
const spec = readFileSync(demoPath, 'utf8');
const source = { kind: 'openapi', spec, format: 'yaml' } as const;

const EXPECTED_ENDPOINTS = 20;

describe('demo OpenAPI import (swagger-first showcase)', () => {
  it('Desktop/Node path (swagger-parser) yields 20 endpoints, no warnings', async () => {
    const { endpoints, warnings } = await parseNode(source);
    expect(endpoints).toHaveLength(EXPECTED_ENDPOINTS);
    expect(warnings).toEqual([]);
  });

  it('Web path (/parsing, in-document $ref only) yields the same 20 endpoints, no external-ref warnings', async () => {
    const { endpoints, warnings } = await parseBrowser(source);
    expect(endpoints).toHaveLength(EXPECTED_ENDPOINTS);
    // Every $ref in the demo is in-document (#/components/...), so the browser
    // resolver must resolve them all — no external-ref warnings.
    expect(warnings).toEqual([]);
  });

  it('both surfaces produce the identical endpoint set (method + path)', async () => {
    const sig = (r: { endpoints: Array<{ method: string; pathPattern: string }> }) =>
      r.endpoints.map((e) => `${e.method} ${e.pathPattern}`).sort();
    const [node, browser] = await Promise.all([parseNode(source), parseBrowser(source)]);
    expect(sig(browser)).toEqual(sig(node));
  });

  it('resolves an in-document response-schema $ref into a synthesized body', async () => {
    const { endpoints } = await parseBrowser(source);
    // /organizations POST → 201 body references Create... but the response
    // example is inlined; pick /health which has an explicit example + a
    // schema $ref, and assert the example round-trips.
    const health = endpoints.find((e) => e.pathPattern === '/health' && e.method === 'GET');
    expect(health).toBeDefined();
    expect(health!.defaultResponse.status).toBe(200);
    expect(JSON.parse(health!.defaultResponse.body.content)).toMatchObject({ status: 'ok' });
  });
});
