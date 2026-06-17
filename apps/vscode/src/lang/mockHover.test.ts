import { describe, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { MockHoverProvider } from './mockHover';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { VsCodeMockController } from '../host/vscodeMockController';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({
      text: lines[line] ?? '',
      range: {
        start: { line, character: 0 },
        end: { line, character: (lines[line] ?? '').length },
      },
    }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;
const pos = (line: number, ch: number) => ({ line, character: ch }) as unknown as vscode.Position;

function makeBridge(mockServers: Record<string, unknown>): VsCodeBridge {
  return {
    activeWorkspace: () => ({ read: () => Promise.resolve({ synced: { mockServers } }) }),
  } as unknown as VsCodeBridge;
}

function makeController(runtime: { port: number; startedAt: string } | null): VsCodeMockController {
  return {
    runtime: async () =>
      runtime ? { ...runtime, pid: 1, lastError: null, requestCount: 0 } : null,
  } as unknown as VsCodeMockController;
}

const mockShape = {
  m1: {
    id: 'm1',
    name: 'Pet Store',
    source: { kind: 'manual' },
    endpoints: [
      {
        id: 'e1',
        method: 'GET',
        pathPattern: '/pets',
        name: 'list pets',
        description: 'List the pets',
        defaultResponse: { status: 200 },
        responseRules: [{ id: 'r1' }],
      },
    ],
    defaultPort: 3000,
  },
};

describe('MockHoverProvider', () => {
  it('returns undefined for non-apicircle scheme', async () => {
    const p = new MockHoverProvider(makeBridge(mockShape), makeController(null));
    const r = await p.provideHover(
      makeDoc(Uri.parse('file:///x.yaml'), ['name: Pet Store']),
      pos(0, 5),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  it('returns undefined for non-.yaml apicircle URIs', async () => {
    const p = new MockHoverProvider(makeBridge(mockShape), makeController(null));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/requests/r.yaml'), ['name: Pet Store']),
      pos(0, 5),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  it('hovers on name: shows idle status', async () => {
    const p = new MockHoverProvider(makeBridge(mockShape), makeController(null));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.yaml'), ['name: Pet Store']),
      pos(0, 5),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('Pet Store');
    expect(md.value).toContain('Idle');
  });

  it('hovers on name: shows running status with port', async () => {
    const p = new MockHoverProvider(
      makeBridge(mockShape),
      makeController({ port: 4040, startedAt: '2026-01-01T00:00:00Z' }),
    );
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.yaml'), ['name: Pet Store']),
      pos(0, 5),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('Running');
    expect(md.value).toContain(':4040');
  });

  it('F-G8: hovers on cors.enabled documents CORS semantics', async () => {
    const p = new MockHoverProvider(makeBridge(mockShape), makeController(null));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.yaml'), ['cors:', '  enabled: true']),
      pos(1, 12),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('CORS');
    expect(md.value).toContain('Access-Control-Allow-Origin');
  });

  it('F-G8: does NOT trigger CORS hover on enabled: outside cors block', async () => {
    const p = new MockHoverProvider(makeBridge(mockShape), makeController(null));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.yaml'), ['name: x', '  enabled: true']),
      pos(1, 12),
      fakeToken,
    );
    // Without a cors: block above, the line doesn't match a known hover kind.
    expect(r).toBeUndefined();
  });

  it('P3R6-G3: hovers on bytes: explains the secret-safety projection', async () => {
    const p = new MockHoverProvider(makeBridge(mockShape), makeController(null));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.yaml'), ['  bytes: 4521']),
      pos(0, 9),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('4,521');
    expect(md.value).toContain('Source spec');
    expect(md.value).toContain('workspace.json');
    expect(md.value).toContain('security');
  });

  it('hovers on defaultPort: <n> shows the bind target', async () => {
    const p = new MockHoverProvider(makeBridge(mockShape), makeController(null));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.yaml'), ['defaultPort: 3000']),
      pos(0, 14),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('localhost:3000');
  });

  it('hovers on defaultPort: null explains free-port semantics', async () => {
    const p = new MockHoverProvider(makeBridge(mockShape), makeController(null));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.yaml'), ['defaultPort: null']),
      pos(0, 14),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('free port');
  });

  it('hovers on pathPattern: shows endpoint details', async () => {
    const p = new MockHoverProvider(makeBridge(mockShape), makeController(null));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.yaml'), [
        '  - id: e1',
        '    method: GET',
        '    pathPattern: /pets',
      ]),
      pos(2, 20),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('GET');
    expect(md.value).toContain('/pets');
    expect(md.value).toContain('Default response');
    expect(md.value).toContain('200');
  });

  it('P3R1-G1: disambiguates duplicate paths by walking back to method: line', async () => {
    const dup = {
      m1: {
        id: 'm1',
        name: 'Pet Store',
        source: { kind: 'manual' },
        endpoints: [
          {
            id: 'g',
            method: 'GET',
            pathPattern: '/pets',
            name: 'list',
            description: 'List pets',
            defaultResponse: { status: 200 },
            responseRules: [],
          },
          {
            id: 'p',
            method: 'POST',
            pathPattern: '/pets',
            name: 'create',
            description: 'Create pet',
            defaultResponse: { status: 201 },
            responseRules: [],
          },
        ],
        defaultPort: null,
      },
    };
    const p = new MockHoverProvider(makeBridge(dup), makeController(null));
    // Hover on the POST endpoint's pathPattern — should resolve to id 'p' (status 201).
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.yaml'), [
        '  - id: p',
        '    method: POST',
        '    pathPattern: /pets',
      ]),
      pos(2, 20),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('POST');
    expect(md.value).toContain('Create pet');
    expect(md.value).toContain('201');
  });

  it('returns undefined on unrelated lines', async () => {
    const p = new MockHoverProvider(makeBridge(mockShape), makeController(null));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.yaml'), ['# header']),
      pos(0, 2),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  void vi;
});
