import { describe, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { MockCodeLensProvider } from './mockCodeLens';
import type { VsCodeMockController } from '../host/vscodeMockController';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;

function makeController(running: boolean, port = 3000): VsCodeMockController {
  return {
    isRunning: async () => running,
    runtime: async () =>
      running ? { port, pid: 1, startedAt: '2026', lastError: null, requestCount: 0 } : null,
    // F-G12: CodeLens subscribes to onChange so the lens flips on lifecycle events.
    onChange: () => ({ dispose: () => {} }),
  } as unknown as VsCodeMockController;
}

describe('MockCodeLensProvider', () => {
  it('returns [] for non-apicircle scheme', async () => {
    const p = new MockCodeLensProvider(makeController(false));
    const lenses = await p.provideCodeLenses(
      makeDoc(Uri.parse('file:///x.yaml'), ['name: x']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('returns [] for apicircle URIs that are not .yaml', async () => {
    const p = new MockCodeLensProvider(makeController(false));
    const lenses = await p.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/r.yaml'), ['name: x']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('returns ▶ Start when mock is not running', async () => {
    const p = new MockCodeLensProvider(makeController(false));
    const lenses = await p.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/mocks/m-1.yaml'), ['# header', 'name: Pet Store']),
      fakeToken,
    );
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.title).toBe('▶ Start Mock');
    expect(lenses[0].command?.command).toBe('apicircle.startMock');
    expect(lenses[0].command?.arguments).toEqual([{ kind: 'server', id: 'm-1' }]);
  });

  it('returns ■ Stop + ↻ Restart when mock is running', async () => {
    const p = new MockCodeLensProvider(makeController(true, 4040));
    const lenses = await p.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/mocks/m-1.yaml'), ['name: Pet Store']),
      fakeToken,
    );
    expect(lenses).toHaveLength(2);
    expect(lenses[0].command?.title).toContain('Stop Mock');
    expect(lenses[0].command?.title).toContain(':4040');
    expect(lenses[0].command?.command).toBe('apicircle.stopMock');
    expect(lenses[1].command?.title).toBe('↻ Restart');
    expect(lenses[1].command?.command).toBe('apicircle.restartMock');
  });

  it('returns [] when no name: line is present', async () => {
    const p = new MockCodeLensProvider(makeController(false));
    const lenses = await p.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/mocks/m-1.yaml'), ['# no name field']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('refresh fires the change event', () => {
    const p = new MockCodeLensProvider(makeController(false));
    let fired = false;
    p.onDidChangeCodeLenses(() => (fired = true));
    p.refresh();
    expect(fired).toBe(true);
  });

  it('does NOT emit per-endpoint editing lenses — those belong on the per-endpoint YAML', async () => {
    // After the per-endpoint YAML projection landed, the mock.yaml is back
    // to a pure lifecycle surface. Per-endpoint editing happens via
    // <endpointId>.yaml (opened from the Mock sidebar). Emitting
    // the editing lenses here would invoke commands that bail with the
    // "only runs against endpoint YAML" toast.
    const p = new MockCodeLensProvider(makeController(false));
    const lenses = await p.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/mocks/m-1.yaml'), [
        'name: Pet Store',
        'endpoints:',
        '  - id: ep-1',
        '    method: GET',
        '    pathPattern: /pets',
        '    name: List pets',
        '    defaultStatus: 200',
      ]),
      fakeToken,
    );
    const editingCommands = new Set([
      'apicircle.switchMockResponseBodyType',
      'apicircle.setMockResponseStatus',
      'apicircle.addMockResponseRule',
      'apicircle.addMockValidationRule',
      'apicircle.addMockMultiplier',
    ]);
    const editingLenses = lenses.filter((l) => l.command && editingCommands.has(l.command.command));
    expect(editingLenses).toHaveLength(0);
    // Lifecycle controls remain.
    const lifecycleCommands = new Set([
      'apicircle.startMock',
      'apicircle.stopMock',
      'apicircle.restartMock',
    ]);
    expect(lenses.some((l) => l.command && lifecycleCommands.has(l.command.command))).toBe(true);
  });

  it('reads the mock id from the ?id= query, not the name-slug path basename', async () => {
    // Real URIs are `/mocks/<name-slug>.yaml?id=<mockId>` — the slug is
    // NOT the id. Earlier the lens parsed the id from the path basename, so the
    // Start/Open commands received the slug and missed synced.mockServers[id].
    const p = new MockCodeLensProvider(makeController(false));
    const lenses = await p.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/mocks/pet-store.yaml?id=m-42'), [
        'name: Pet Store',
        'endpoints:',
        '  - id: ep-1',
        '    method: GET',
      ]),
      fakeToken,
    );
    expect(lenses[0].command?.arguments).toEqual([{ kind: 'server', id: 'm-42' }]);
    const open = lenses.find((l) => l.command?.command === 'apicircle.openMockEndpointYaml');
    expect(open?.command?.arguments).toEqual([
      { kind: 'endpoint', serverId: 'm-42', endpointId: 'ep-1' },
    ]);
  });

  it('emits an ↗ Open endpoint lens per endpoint row, carrying the MockView node shape', async () => {
    const p = new MockCodeLensProvider(makeController(false));
    const lenses = await p.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/mocks/m-1.yaml'), [
        'name: Pet Store',
        'endpoints:',
        '  - id: ep-1',
        '    method: GET',
        '    pathPattern: /pets',
        '  - id: ep-2',
        '    method: POST',
        '    pathPattern: /pets',
        'defaultPort: null',
      ]),
      fakeToken,
    );
    const opens = lenses.filter((l) => l.command?.command === 'apicircle.openMockEndpointYaml');
    expect(opens).toHaveLength(2);
    expect(opens[0].command?.title).toBe('↗ Open endpoint');
    expect(opens[0].command?.arguments).toEqual([
      { kind: 'endpoint', serverId: 'm-1', endpointId: 'ep-1' },
    ]);
    expect(opens[1].command?.arguments).toEqual([
      { kind: 'endpoint', serverId: 'm-1', endpointId: 'ep-2' },
    ]);
  });

  void vi;
});
