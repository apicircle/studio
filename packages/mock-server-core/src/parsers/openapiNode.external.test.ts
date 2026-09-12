import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseOpenApiToEndpointsNode, parseOpenApiRequestBodiesNode } from './openapiNode';

// A spec is always handed to us as an in-memory string — a pasted document, a
// workspace asset, a git-synced mock source, an MCP argument. None of those has
// a trustworthy base directory, so a `$ref` that points outside the document is
// a request for this process to read a file or open a connection on behalf of
// whoever wrote the spec. These tests pin that it never happens: the secret
// marker must not reach the parsed endpoints, and the HTTP server must stay at
// zero requests.

const MARKER = 'apicircle-openapi-ref-test-secret-9f2b41';

const toPosix = (p: string) => p.split(sep).join('/');

let dir: string;
let secretPath: string;
let server: Server;
let requests: string[];
let httpRef: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'apicircle-ref-'));
  secretPath = join(dir, 'fake_credentials');
  writeFileSync(secretPath, `aws_secret_access_key = ${MARKER}\n`, 'utf8');

  requests = [];
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ leaked: MARKER }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  httpRef = `http://127.0.0.1:${port}/internal-metadata`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

/** The four shapes json-schema-ref-parser would otherwise follow: a `file:` URL,
 *  a bare absolute path, a path relative to the PROCESS cwd (not the spec's own
 *  directory — an in-memory spec has none), and an http URL. */
const externalRefs = () => ({
  fileUrl: `file:///${toPosix(secretPath)}`,
  absolute: toPosix(secretPath),
  relative: toPosix(relative(process.cwd(), secretPath)),
  http: httpRef,
});

function specWithExternalRefs(): string {
  const refs = externalRefs();
  const op = (ref: string) => ({
    responses: {
      '200': {
        description: 'ok',
        content: { 'application/json': { example: { $ref: ref } } },
      },
    },
  });
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'External refs', version: '1.0.0' },
    components: {
      schemas: {
        Pet: {
          type: 'object',
          required: ['id', 'name'],
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
        },
      },
    },
    paths: {
      '/file-url': { get: op(refs.fileUrl) },
      '/absolute': { get: op(refs.absolute) },
      '/relative': { get: op(refs.relative) },
      '/http': { get: op(refs.http) },
      '/in-document': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
            },
          },
        },
      },
    },
  });
}

describe('parseOpenApiToEndpointsNode — external $refs are never followed', () => {
  it('reads no file and opens no connection, and names every unresolved ref', async () => {
    const { endpoints, warnings } = await parseOpenApiToEndpointsNode(
      specWithExternalRefs(),
      'json',
    );

    // Nothing the refs pointed at reached the mock endpoints.
    const serialized = JSON.stringify(endpoints);
    expect(serialized).not.toContain(MARKER);
    expect(requests).toEqual([]);

    // Every distinct external ref is named, once. Matched with the quotes the
    // warning puts around the ref, so the bare absolute path doesn't also count
    // as a match inside the `file:///<same path>` warning.
    const refs = externalRefs();
    for (const ref of Object.values(refs)) {
      expect(warnings.filter((w) => w.includes(`"${ref}"`))).toHaveLength(1);
    }
    expect(warnings).toHaveLength(Object.keys(refs).length);
    expect(warnings[0]).toContain('External $ref not resolved');

    // The document still parses: five operations, and the in-document ref is
    // resolved exactly as before.
    expect(endpoints).toHaveLength(5);
    const inDocument = endpoints.find((e) => e.pathPattern === '/in-document');
    expect(JSON.parse(inDocument!.defaultResponse.body.content)).toEqual({
      id: 0,
      name: 'string',
    });
  });

  it('leaves the unresolved ref in the body instead of the file contents', async () => {
    const { endpoints } = await parseOpenApiToEndpointsNode(specWithExternalRefs(), 'json');
    const fileUrl = endpoints.find((e) => e.pathPattern === '/file-url');
    expect(JSON.parse(fileUrl!.defaultResponse.body.content)).toEqual({
      $ref: externalRefs().fileUrl,
    });
  });
});

/** A YAML anchor graph: 30 levels, each aliasing the previous one 10 times, with
 *  the external ref on the anchored leaf. js-yaml returns one shared object per
 *  anchor, so the leaf is reachable 10^30 ways through ~4 KB of source — a walk
 *  that followed every path would never come back. */
function aliasGraphSpec(): string {
  const lines = [
    'openapi: "3.0.0"',
    'info:',
    '  title: Alias graph',
    '  version: 1.0.0',
    'x-anchors:',
    `  - &a0 { $ref: "${httpRef}" }`,
  ];
  for (let level = 1; level <= 30; level += 1) {
    const props = Array.from({ length: 10 }, (_, p) => `p${p}: *a${level - 1}`).join(', ');
    lines.push(`  - &a${level} { type: object, properties: { ${props} } }`);
  }
  lines.push(
    'paths:',
    '  /ok:',
    '    get:',
    '      responses:',
    '        "200":',
    '          description: ok',
    '          content: { application/json: { example: { ok: true } } }',
  );
  return lines.join('\n');
}

describe('parseOpenApiToEndpointsNode — refs reached through YAML aliases', () => {
  it('names the ref once and stays fast on an alias graph', async () => {
    const source = aliasGraphSpec();
    expect(source.length).toBeLessThan(10_000);

    const started = Date.now();
    const { endpoints, warnings } = await parseOpenApiToEndpointsNode(source, 'yaml');
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1000);
    expect(requests).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(httpRef);
    expect(endpoints).toHaveLength(1);
    expect(JSON.parse(endpoints[0].defaultResponse.body.content)).toEqual({ ok: true });
  });
});

describe('parseOpenApiRequestBodiesNode — external $refs are never followed', () => {
  it('keeps a request-body ref unresolved and warns', async () => {
    const refs = externalRefs();
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'External body ref', version: '1.0.0' },
      paths: {
        '/pets': {
          post: {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { $ref: refs.fileUrl } } },
            },
            responses: { '201': { description: 'created' } },
          },
        },
      },
    });
    const { requestBodies, warnings } = await parseOpenApiRequestBodiesNode(spec, 'json');
    expect(JSON.stringify(requestBodies)).not.toContain(MARKER);
    expect(requests).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(refs.fileUrl);
    expect(requestBodies[0].schema).toEqual({ $ref: refs.fileUrl });
  });
});
