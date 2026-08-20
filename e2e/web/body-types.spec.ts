// Body types — every supported body type set in the editor and asserted
// on the wire via the mock server's /anything echo.
//
// Body type → wire body.kind mapping the mock server reports:
//   none        → empty
//   json        → json (with parsed shape)
//   text        → text
//   xml         → text (XML is text/xml on the wire)
//   urlencoded  → form
//   form-data   → multipart
//   binary      → binary (byte length only)
//   graphql     → json (envelope { query, variables })

import { expect, test } from './fixtures/app';
import type { CapturedRequestSummary } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
import { tcMapBE } from './fixtures/tcMapBE';

function id(key: string): TcId {
  const v = tcMapBE[key];
  if (!v) throw new Error(`No TC-BE entry for "${key}"`);
  return v;
}

/**
 * Walk the mock server's introspection buffer for a multipart request to
 * `path` whose parts satisfy `hasPart`. The form-data tests share the
 * `/upload` route across parallel workers, so each test discriminates its
 * own request by a unique part name rather than by path alone.
 */
async function findMultipartParts(
  baseUrl: string,
  path: string,
  hasPart: (
    parts: NonNullable<Extract<CapturedRequestSummary['body'], { kind: 'multipart' }>['parts']>,
  ) => boolean,
): Promise<Extract<CapturedRequestSummary['body'], { kind: 'multipart' }>['parts']> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/__inspect/last?n=200`);
    if (res.ok) {
      const body = (await res.json()) as { entries: CapturedRequestSummary[] };
      for (const entry of body.entries) {
        if (entry.path === path && entry.body.kind === 'multipart' && hasPart(entry.body.parts)) {
          return entry.body.parts;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no multipart request to ${path} matched the part predicate`);
}
test.describe('Request body types', () => {
  test(
    tc(id('Type'), 'none: wire body.kind === empty @smoke'),
    async ({ app, e2eMock, sidebar }) => {
      const path = '/anything/body-none';
      await sidebar.createRequest('body-none');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      // Default is `none`; click radio for explicitness.
      await app.getByRole('radio', { name: 'none' }).click();
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.body.kind).toBe('empty');
    },
  );

  test(
    tc(id('Raw JSON :: Submit JSON body'), 'json: wire body.kind === json with parsed shape'),
    async ({ app, monaco, e2eMock, sidebar }) => {
      const path = '/anything/body-json';
      await sidebar.createRequest('body-json');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'JSON' }).click();
      await monaco.fill('Request body', '{"name":"alice","n":42}');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.body.kind).toBe('json');
      if (wire.body.kind === 'json') {
        expect(wire.body.json).toEqual({ name: 'alice', n: 42 });
      }
    },
  );

  test(
    tc(id('Raw Text'), 'text: wire body.kind === text with raw content'),
    async ({ app, monaco, e2eMock, sidebar }) => {
      const path = '/anything/body-text';
      await sidebar.createRequest('body-text');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'text' }).click();
      await monaco.fill('Request body', 'plain ascii payload');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.body.kind).toBe('text');
      if (wire.body.kind === 'text') expect(wire.body.text).toBe('plain ascii payload');
    },
  );

  test(
    tc(id('Raw XML'), 'xml: wire body.kind === text'),
    async ({ app, monaco, e2eMock, sidebar }) => {
      const path = '/anything/body-xml';
      await sidebar.createRequest('body-xml');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'XML' }).click();
      await monaco.fill('Request body', '<root><child>hi</child></root>');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.body.kind).toBe('text');
      if (wire.body.kind === 'text') expect(wire.body.text).toContain('<child>hi</child>');
    },
  );

  test(
    tc(
      id('URL-encoded :: Submit urlencoded'),
      'urlencoded: wire body.kind === form with parsed key/value pairs',
    ),
    async ({ app, e2eMock, sidebar }) => {
      const path = '/anything/body-urlencoded-empty-value';
      await sidebar.createRequest('body-urlencoded');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'urlencoded' }).click();
      await app.getByLabel('Form field key 1').fill('emptyValue');
      await app.getByLabel('Form field value 1').fill('');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();

      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.body.kind).toBe('form');
      if (wire.body.kind === 'form') {
        expect(wire.body.form).toEqual({ emptyValue: '' });
      }
    },
  );

  test(
    tc(id('Form Data :: Submit text field'), 'form-data: text fields echo as multipart parts'),
    async ({ app, e2eMock, sidebar }) => {
      // Use a unique field value so parallel /upload tests don't trip on
      // each other's findLastByPath match. A fresh suffix per run scopes
      // the assertion to OUR request even when 6 workers are hammering
      // /upload simultaneously.
      const tag = `form-text-${Math.random().toString(36).slice(2, 10)}`;
      const path = '/upload';
      await sidebar.createRequest('body-form-text');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'form-data' }).click();
      await app.getByRole('button', { name: /^Add text$/ }).click();
      await app.getByLabel('Form-data row 1 key').fill('username');
      await app.getByLabel('Form-data row 1 value').fill(tag);
      await app.getByRole('button', { name: /^Add text$/ }).click();
      await app.getByLabel('Form-data row 2 key').fill('role');
      await app.getByLabel('Form-data row 2 value').fill('admin');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      // Walk the inspect buffer for OUR upload (uniquely identified by
      // the random tag in the username field). This is robust against
      // parallel-worker /upload contention.
      const deadline = Date.now() + 3000;
      let wireBody: import('./fixtures/app').CapturedRequestSummary['body'] | undefined;
      while (Date.now() < deadline && !wireBody) {
        const r = await fetch(`${e2eMock.baseUrl}/__inspect/last?n=200`);
        const body = (await r.json()) as {
          entries: import('./fixtures/app').CapturedRequestSummary[];
        };
        for (const entry of body.entries) {
          if (entry.path !== path || entry.body.kind !== 'multipart') continue;
          if (entry.body.parts.some((p) => p.name === 'username' && p.text === tag)) {
            wireBody = entry.body;
            break;
          }
        }
        if (!wireBody) await new Promise((r) => setTimeout(r, 50));
      }
      expect(wireBody).toBeDefined();
      if (wireBody?.kind === 'multipart') {
        expect(wireBody.parts.some((p) => p.name === 'username' && p.text === tag)).toBe(true);
        expect(wireBody.parts.some((p) => p.name === 'role' && p.text === 'admin')).toBe(true);
      }
    },
  );

  test(
    tc(
      id('Form Data :: Upload file row'),
      'form-data: file upload attaches and the wire receives a multipart file part',
    ),
    async ({ app, e2eMock, sidebar }) => {
      // Unique query so parallel /upload tests don't shadow each other.
      const url = `${e2eMock.url('/upload')}?t=form-file`;
      await sidebar.createRequest('body-form-file');
      await app.getByLabel('Request URL').fill(url);
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'form-data' }).click();
      await app.getByRole('button', { name: /^Add file$/ }).click();
      await app.getByLabel('Form-data row 1 key').fill('avatar');
      const fileInput = app.getByLabel('Form-data row 1 file');
      await fileInput.setInputFiles({
        name: 'pixel.png',
        mimeType: 'image/png',
        buffer: Buffer.from([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a,
          ...Array.from({ length: 16 }, (_v, i) => i & 0xff),
        ]),
      });
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      // Walk the inspect buffer for a captured /upload request whose
      // multipart parts contain the pixel.png file — this is robust
      // against parallel-worker contention on the shared mock buffer.
      const deadline = Date.now() + 3000;
      let filePart: { filename?: string; contentType?: string; bytes?: number } | undefined;
      while (Date.now() < deadline && !filePart) {
        const r = await fetch(`${e2eMock.baseUrl}/__inspect/last?n=200`);
        const body = (await r.json()) as {
          entries: import('./fixtures/app').CapturedRequestSummary[];
        };
        for (const entry of body.entries) {
          if (entry.path !== '/upload' || entry.body.kind !== 'multipart') continue;
          const found = entry.body.parts.find((p) => p.filename === 'pixel.png');
          if (found) {
            filePart = found;
            break;
          }
        }
        if (!filePart) await new Promise((r) => setTimeout(r, 50));
      }
      expect(filePart).toBeDefined();
      expect(filePart!.contentType).toBe('image/png');
      expect(filePart!.bytes).toBe(24);
    },
  );

  test(
    tc(id('Binary'), 'binary: file upload sends as application/octet-stream-like body'),
    async ({ app, e2eMock, sidebar }) => {
      const path = '/anything/body-binary';
      await sidebar.createRequest('body-binary');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'binary' }).click();
      const fileInput = app.getByLabel('Binary body file');
      const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0x00, 0x42]);
      await fileInput.setInputFiles({
        name: 'payload.bin',
        mimeType: 'application/octet-stream',
        buffer: bytes,
      });
      // Wait for the file's IDB persist to finalize before clicking Send.
      // The binary body's attachmentResolver looks the slot up by id, and
      // a click landing inside the same tick as setInputFiles can race
      // the IDB transaction → resolver returns null → wire body kind is
      // 'empty' (the failure mode that flaked this test under load).
      await expect
        .poll(async () =>
          app.evaluate(() => {
            const w = window as unknown as {
              __apicircleStore?: {
                getState: () => {
                  local?: { ui: { activeRequestId: string | null } };
                  synced?: {
                    collections: {
                      requests: Record<
                        string,
                        { body: { type: string; attachment?: { slotId: string } } }
                      >;
                    };
                  };
                };
              };
            };
            const id = w.__apicircleStore!.getState().local!.ui.activeRequestId!;
            return Boolean(
              w.__apicircleStore!.getState().synced!.collections.requests[id]?.body.attachment
                ?.slotId,
            );
          }),
        )
        .toBe(true);
      await app.getByRole('button', { name: /^Send$/ }).click();
      // Binary body upload + 6-worker dev server transform queue under
      // load can push the round-trip past the default 5s `expect` window.
      // The wire assertion below also has a 3s deadline, so 10s here is
      // a safe ceiling that matches the path the test is actually exercising.
      await expect(app.getByText('200').first()).toBeVisible({ timeout: 10_000 });
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.body.kind).toBe('binary');
      if (wire.body.kind === 'binary') {
        expect(wire.body.bytes).toBe(bytes.length);
      }
    },
  );

  test(
    tc(
      id('GraphQL :: Send GraphQL query'),
      'graphql: wire body wraps query+variables in JSON envelope',
    ),
    async ({ app, monaco, e2eMock, sidebar }) => {
      const path = '/anything/body-graphql';
      await sidebar.createRequest('body-graphql');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'GraphQL' }).click();
      await monaco.fill('GraphQL query', 'query Q($id: ID!) { user(id: $id) { name } }');
      await monaco.fill('GraphQL variables', '{"id":"42"}');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      // Mock-server classifies `application/graphql` content-type as text
      // (the body is the JSON envelope as a string, not parsed JSON).
      expect(wire.body.kind).toBe('text');
      if (wire.body.kind === 'text') {
        const parsed = JSON.parse(wire.body.text);
        expect(parsed).toMatchObject({
          query: 'query Q($id: ID!) { user(id: $id) { name } }',
          variables: { id: '42' },
        });
      }
    },
  );
});

test.describe('Request body types — matrix', () => {
  test(
    tc(
      id('Form Data :: Empty value row'),
      'form-data: a text field with an empty value reaches the wire',
    ),
    async ({ app, e2eMock, sidebar }) => {
      const key = `empty-${Math.random().toString(36).slice(2, 10)}`;
      await sidebar.createRequest('body-fd-empty');
      await app.getByLabel('Request URL').fill(e2eMock.url('/upload'));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'form-data' }).click();
      await app.getByRole('button', { name: /^Add text$/ }).click();
      await app.getByLabel('Form-data row 1 key').fill(key);
      await app.getByLabel('Form-data row 1 value').fill('');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const parts = await findMultipartParts(e2eMock.baseUrl, '/upload', (ps) =>
        ps.some((p) => p.name === key),
      );
      expect(parts.find((p) => p.name === key)?.text ?? null).toBe('');
    },
  );

  test(
    tc(
      id('Form Data :: Unicode field name'),
      'form-data: a Unicode field name reaches the wire intact',
    ),
    async ({ app, e2eMock, sidebar }) => {
      const key = `имя-${Math.random().toString(36).slice(2, 8)}`;
      await sidebar.createRequest('body-fd-unicode');
      await app.getByLabel('Request URL').fill(e2eMock.url('/upload'));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'form-data' }).click();
      await app.getByRole('button', { name: /^Add text$/ }).click();
      await app.getByLabel('Form-data row 1 key').fill(key);
      await app.getByLabel('Form-data row 1 value').fill('present');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const parts = await findMultipartParts(e2eMock.baseUrl, '/upload', (ps) =>
        ps.some((p) => p.name === key),
      );
      expect(parts.some((p) => p.name === key && p.text === 'present')).toBe(true);
    },
  );

  test(
    tc(
      id('URL-encoded :: Reserved chars encoded'),
      'urlencoded: reserved characters round-trip through percent-encoding',
    ),
    async ({ app, e2eMock, sidebar }) => {
      const path = `/anything/body-urlenc-reserved-${Math.random().toString(36).slice(2, 8)}`;
      await sidebar.createRequest('body-urlenc-reserved');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'urlencoded' }).click();
      await app.getByLabel('Form field key 1').fill('q');
      await app.getByLabel('Form field value 1').fill('a b&c=d');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.body.kind).toBe('form');
      if (wire.body.kind === 'form') {
        // Reserved characters are percent-encoded exactly once, so the
        // value round-trips intact — it neither fragments the body into
        // extra keys nor arrives still-encoded.
        expect(wire.body.form).toEqual({ q: 'a b&c=d' });
      }
    },
  );

  test(
    tc(id('GraphQL :: Variables sent'), 'graphql: query variables travel in the JSON envelope'),
    async ({ app, monaco, e2eMock, sidebar }) => {
      const path = `/anything/body-gql-vars-${Math.random().toString(36).slice(2, 8)}`;
      await sidebar.createRequest('body-gql-vars');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'GraphQL' }).click();
      await monaco.fill(
        'GraphQL query',
        'query Items($limit: Int!, $tag: String!) { items(limit: $limit, tag: $tag) { id } }',
      );
      await monaco.fill('GraphQL variables', '{"limit":7,"tag":"books"}');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.body.kind).toBe('text');
      if (wire.body.kind === 'text') {
        const parsed = JSON.parse(wire.body.text) as { variables: unknown };
        expect(parsed.variables).toEqual({ limit: 7, tag: 'books' });
      }
    },
  );

  test(
    tc(
      id('GraphQL :: Mutation operation'),
      'graphql: a mutation operation is sent in the envelope',
    ),
    async ({ app, monaco, e2eMock, sidebar }) => {
      const path = `/anything/body-gql-mutation-${Math.random().toString(36).slice(2, 8)}`;
      await sidebar.createRequest('body-gql-mutation');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'GraphQL' }).click();
      await monaco.fill(
        'GraphQL query',
        'mutation AddPet($name: String!) { addPet(name: $name) { id } }',
      );
      await monaco.fill('GraphQL variables', '{"name":"Rex"}');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.body.kind).toBe('text');
      if (wire.body.kind === 'text') {
        const parsed = JSON.parse(wire.body.text) as { query: string };
        expect(parsed.query).toContain('mutation AddPet');
      }
    },
  );

  test(
    tc(
      id('GraphQL :: Fragments and directives'),
      'graphql: fragments and directives survive into the envelope query',
    ),
    async ({ app, monaco, e2eMock, sidebar }) => {
      const path = `/anything/body-gql-frag-${Math.random().toString(36).slice(2, 8)}`;
      await sidebar.createRequest('body-gql-frag');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'GraphQL' }).click();
      await monaco.fill(
        'GraphQL query',
        'query Hero($withFriends: Boolean!) { hero { ...HeroFields friends @include(if: $withFriends) { name } } } fragment HeroFields on Character { name }',
      );
      await monaco.fill('GraphQL variables', '{"withFriends":true}');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.body.kind).toBe('text');
      if (wire.body.kind === 'text') {
        const parsed = JSON.parse(wire.body.text) as { query: string };
        expect(parsed.query).toContain('fragment HeroFields on Character');
        expect(parsed.query).toContain('@include(if: $withFriends)');
      }
    },
  );

  test(
    tc(id('Type Switch'), 'switching body type from JSON to text changes the wire body kind'),
    async ({ app, monaco, e2eMock, sidebar }) => {
      const path = `/anything/body-type-switch-${Math.random().toString(36).slice(2, 8)}`;
      await sidebar.createRequest('body-type-switch');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      // Author a JSON body, then switch the type over to text.
      await app.getByRole('radio', { name: 'JSON' }).click();
      await monaco.fill('Request body', '{"shape":"json"}');
      await app.getByRole('radio', { name: 'text', exact: true }).click();
      await monaco.fill('Request body', 'now-plain-text');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.body.kind).toBe('text');
      if (wire.body.kind === 'text') expect(wire.body.text).toBe('now-plain-text');
    },
  );

  test(
    tc(
      id('File Upload :: Browser file picker'),
      'a file chosen via the picker is recorded on the form-data row',
    ),
    async ({ app, sidebar }) => {
      await sidebar.createRequest('body-fd-picker');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'form-data' }).click();
      await app.getByRole('button', { name: /^Add file$/ }).click();
      await app.getByLabel('Form-data row 1 key').fill('attachment');
      await app.getByLabel('Form-data row 1 file').setInputFiles({
        name: 'report.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('PDF-bytes'),
      });
      // The picked file is recorded on the active request's body form rows.
      const filename = await app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => {
              local?: { ui: { activeRequestId: string | null } };
              synced?: {
                collections: {
                  requests: Record<
                    string,
                    { body: { formRows?: Array<{ kind: string; filename?: string }> } }
                  >;
                };
              };
            };
          };
        };
        const s = w.__apicircleStore!.getState();
        const reqId = s.local!.ui.activeRequestId!;
        const rows = s.synced!.collections.requests[reqId]?.body.formRows ?? [];
        return rows.find((r) => r.kind === 'file')?.filename ?? null;
      });
      expect(filename).toBe('report.pdf');
    },
  );

  // Cells blocked on a missing product affordance or an un-simulable
  // interaction — kept as fixme with a specific rationale so each literal
  // `id('...')` still credits the cell to this spec.
  test.fixme(
    tc(id('Form Data :: Upload 50MB file'), 'form-data: a 50MB file uploads without truncation'),
    () => {
      // A literal 50MB upload blows the Playwright per-test budget; small-
      // file form-data upload is covered by 'Form Data :: Upload file row'.
    },
  );
  test.fixme(
    tc(id('Form Data :: Multiple files in same row'), 'form-data: multiple files in one row'),
    () => {
      // FormDataRow models a single file per row (slotId is scalar — see
      // packages/shared/src/types.ts) — multi-file rows are not a feature.
    },
  );
  test.fixme(
    tc(
      id('Raw JSON :: Invalid JSON shows squiggle'),
      'json: invalid JSON shows an editor squiggle',
    ),
    () => {
      // Asserting a Monaco diagnostic marker needs editor-internal marker
      // introspection that the test harness does not currently expose.
    },
  );
  test.fixme(
    tc(id('Raw JSON :: JSON schema validates body'), 'json: body is validated against a schema'),
    () => {
      // Body-against-schema validation needs a schema attached via the
      // Global Assets picker plus the editor's validation surface — owned
      // by the JSON-schema diagnostics module.
    },
  );
  test.fixme(tc(id('Raw HTML'), 'html: an HTML body is sent'), () => {
    // There is no dedicated HTML body type; HTML payloads use the `text`
    // body type, which is covered by 'Raw Text' (TC-BE-0015).
  });
  test.fixme(
    tc(id('File Upload :: Drag-drop from OS'), 'a file dragged from the OS attaches'),
    () => {
      // OS-level drag-and-drop onto the file row cannot be simulated by
      // Playwright's input automation.
    },
  );
});
