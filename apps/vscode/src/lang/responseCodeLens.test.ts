import { describe, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import { ResponseCodeLensProvider, formatResponseJsonCommand } from './responseCodeLens';

// ---------------------------------------------------------------------------
// Minimal VS Code stub (mirrors endpointCodeLens.test.ts pattern)
// ---------------------------------------------------------------------------

vi.mock('vscode', () => {
  class Position {
    constructor(
      public line: number,
      public character: number,
    ) {}
  }
  class Range {
    constructor(
      public startLine: number,
      public startChar: number,
      public endLine: number,
      public endChar: number,
    ) {}
  }
  class CodeLens {
    constructor(
      public range: Range,
      public command?: { title: string; command: string; arguments?: unknown[] },
    ) {}
  }
  class Uri {
    scheme: string;
    authority: string;
    path: string;
    query: string;
    fragment: string;
    constructor(opts: Partial<Uri> = {}) {
      this.scheme = opts.scheme ?? '';
      this.authority = opts.authority ?? '';
      this.path = opts.path ?? '';
      this.query = opts.query ?? '';
      this.fragment = opts.fragment ?? '';
    }
    static from(parts: Partial<Uri>): Uri {
      return new Uri(parts);
    }
  }
  class EventEmitter {
    fire(): void {}
    event = (): void => {};
    dispose(): void {}
  }
  return {
    Position,
    Range,
    CodeLens,
    Uri,
    EventEmitter,
    window: {
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      activeTextEditor: undefined,
    },
    workspace: {
      openTextDocument: vi.fn(),
      applyEdit: vi.fn(),
    },
    FileChangeType: { Changed: 2 },
  };
});

const vscodeModule = await import('vscode');

const RESPONSE_URI = vscodeModule.Uri.from({
  scheme: 'apicircle',
  authority: 'x',
  path: '/responses/login.yaml',
  query: 'runId=run-1',
});

function makeDoc(uri: vscode.Uri, lines: string[]): vscode.TextDocument {
  const text = lines.join('\n');
  return {
    uri,
    lineCount: lines.length,
    lineAt: (n: number) => ({
      text: lines[n],
      range: new vscodeModule.Range(n, 0, n, lines[n].length),
    }),
    getText: () => text,
  } as unknown as vscode.TextDocument;
}

const _fakeToken = { isCancellationRequested: false } as vscode.CancellationToken;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResponseCodeLensProvider', () => {
  const provider = new ResponseCodeLensProvider();

  it('emits ⟳ Format JSON on a body (json) section header', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(RESPONSE_URI, [
        '# API Circle Response — Login',
        '',
        '# ── summary ──',
        'request: Login',
        'status: 200 OK',
        '',
        '# ── body (json) ──',
        '{"a":1}',
      ]),
    );
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.command).toBe('apicircle.formatResponseJson');
    expect(lenses[0].command?.arguments).toEqual([RESPONSE_URI, 6]);
    expect(lenses[0].command?.title).toBe('⟳ Format JSON');
  });

  it('emits nothing when body kind is not json', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(RESPONSE_URI, [
        '# API Circle Response — GetXml',
        '',
        '# ── body (xml) ──',
        '<root/>',
      ]),
    );
    expect(lenses).toHaveLength(0);
  });

  it('emits nothing for a non-response URI', () => {
    const otherUri = vscodeModule.Uri.from({
      scheme: 'apicircle',
      authority: 'x',
      path: '/requests/foo/bar.yaml',
      query: 'id=r-1',
    });
    const lenses = provider.provideCodeLenses(makeDoc(otherUri, ['# ── body (json) ──', '{}']));
    expect(lenses).toHaveLength(0);
  });

  it('emits nothing for a non-apicircle scheme', () => {
    const otherUri = vscodeModule.Uri.from({
      scheme: 'file',
      path: '/tmp/responses/x.yaml',
    });
    const lenses = provider.provideCodeLenses(makeDoc(otherUri, ['# ── body (json) ──', '{}']));
    expect(lenses).toHaveLength(0);
  });
});

describe('formatResponseJsonCommand', () => {
  it('shows a warning for a non-response URI', async () => {
    const otherUri = vscodeModule.Uri.from({
      scheme: 'apicircle',
      path: '/requests/foo.yaml',
    });
    await formatResponseJsonCommand(otherUri, 0);
    expect(vscodeModule.window.showWarningMessage).toHaveBeenCalledWith(
      'Open an API Circle response document first.',
    );
  });
});
