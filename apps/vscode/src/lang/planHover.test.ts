import { describe, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { PlanHoverProvider } from './planHover';
import type { VsCodeBridge } from '../host/vscodeBridge';

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

function makeBridge(state: unknown): VsCodeBridge {
  return {
    activeWorkspace: () => ({ read: () => Promise.resolve(state) }),
  } as unknown as VsCodeBridge;
}

describe('PlanHoverProvider', () => {
  const baseState = {
    synced: {
      collections: {
        requests: {
          'req-1': {
            id: 'req-1',
            name: 'Login',
            method: 'POST',
            url: 'https://api.example.com/auth/login',
          },
        },
      },
      linkedWorkspaces: {
        'ws-shared': { id: 'ws-shared', name: 'Shared API' },
      },
    },
  };

  it('returns undefined for non-apicircle scheme', async () => {
    const p = new PlanHoverProvider(makeBridge(baseState));
    const r = await p.provideHover(
      makeDoc(Uri.parse('file:///x.yaml'), ['- requestId: req-1']),
      pos(0, 14),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  it('returns undefined for non-.yaml apicircle URIs', async () => {
    const p = new PlanHoverProvider(makeBridge(baseState));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/requests/r.yaml'), ['- requestId: req-1']),
      pos(0, 14),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  it('returns undefined when no workspace is active', async () => {
    const p = new PlanHoverProvider({
      activeWorkspace: () => undefined,
    } as unknown as VsCodeBridge);
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['- requestId: req-1']),
      pos(0, 14),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  it('returns undefined when hovering on a non-id line', async () => {
    const p = new PlanHoverProvider(makeBridge(baseState));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['name: Smoke']),
      pos(0, 4),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  it('shows request details on a known requestId', async () => {
    const p = new PlanHoverProvider(makeBridge(baseState));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['  - requestId: req-1']),
      pos(0, 16),
      fakeToken,
    );
    expect(r).toBeDefined();
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('Login');
    expect(md.value).toContain('POST');
    expect(md.value).toContain('api.example.com');
  });

  it('warns on an unknown requestId', async () => {
    const p = new PlanHoverProvider(makeBridge(baseState));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['  - requestId: req-ghost']),
      pos(0, 16),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('Unknown request id');
    expect(md.value).toContain('req-ghost');
  });

  it('shows linked workspace details on linkedWorkspaceId', async () => {
    const p = new PlanHoverProvider(makeBridge(baseState));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['    linkedWorkspaceId: ws-shared']),
      pos(0, 22),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('Shared API');
  });

  it('warns on unknown linkedWorkspaceId', async () => {
    const p = new PlanHoverProvider(makeBridge(baseState));
    const r = await p.provideHover(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['    linkedWorkspaceId: ws-ghost']),
      pos(0, 22),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('orphan reference');
  });

  void vi;
});
