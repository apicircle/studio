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
      makeDoc(Uri.parse('file:///x.mock.yaml'), ['name: x']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('returns [] for apicircle URIs that are not .mock.yaml', async () => {
    const p = new MockCodeLensProvider(makeController(false));
    const lenses = await p.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/r.req.yaml'), ['name: x']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('returns ▶ Start when mock is not running', async () => {
    const p = new MockCodeLensProvider(makeController(false));
    const lenses = await p.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/mocks/m-1.mock.yaml'), ['# header', 'name: Pet Store']),
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
      makeDoc(Uri.parse('apicircle://x/mocks/m-1.mock.yaml'), ['name: Pet Store']),
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
      makeDoc(Uri.parse('apicircle://x/mocks/m-1.mock.yaml'), ['# no name field']),
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

  void vi;
});
