import { describe, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { PlanCompletionProvider } from './planCompletion';
import type { VsCodeBridge } from '../host/vscodeBridge';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;
const fakeCtx = {} as unknown as vscode.CompletionContext;
const pos = (line: number, ch: number) => ({ line, character: ch }) as unknown as vscode.Position;

function makeBridge(synced: {
  collections: { requests: Record<string, unknown> };
  environments: { items: Record<string, unknown> };
}): VsCodeBridge {
  return {
    activeWorkspace: () => ({ read: () => Promise.resolve({ synced }) }),
  } as unknown as VsCodeBridge;
}

const emptyState = {
  collections: { requests: {} },
  environments: { items: {} },
};

describe('PlanCompletionProvider', () => {
  it('returns [] for non-apicircle scheme', async () => {
    const p = new PlanCompletionProvider(makeBridge(emptyState));
    const items = await p.provideCompletionItems(
      makeDoc(Uri.parse('file:///x.yaml'), ['name: ']),
      pos(0, 6),
      fakeToken,
      fakeCtx,
    );
    expect(items).toEqual([]);
  });

  it('returns [] for non-.yaml apicircle URIs', async () => {
    const p = new PlanCompletionProvider(makeBridge(emptyState));
    const items = await p.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/requests/r.yaml'), ['name: ']),
      pos(0, 6),
      fakeToken,
      fakeCtx,
    );
    expect(items).toEqual([]);
  });

  it('suggests root field names at column 0', async () => {
    const p = new PlanCompletionProvider(makeBridge(emptyState));
    const items = await p.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['']),
      pos(0, 0),
      fakeToken,
      fakeCtx,
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain('name');
    expect(labels).toContain('steps');
    expect(labels).toContain('variables');
    expect(labels).toContain('envPriorityOrder');
    expect(labels).toContain('stopOnAssertionFailure');
  });

  it('suggests step field names when inside steps:', async () => {
    const p = new PlanCompletionProvider(makeBridge(emptyState));
    const items = await p.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['steps:', '  - ']),
      pos(1, 4),
      fakeToken,
      fakeCtx,
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain('requestId');
    expect(labels).toContain('enabled');
    expect(labels).toContain('linkedWorkspaceId');
  });

  it('suggests key/value fields inside variables:', async () => {
    const p = new PlanCompletionProvider(makeBridge(emptyState));
    const items = await p.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['variables:', '  - ']),
      pos(1, 4),
      fakeToken,
      fakeCtx,
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain('key');
    expect(labels).toContain('value');
  });

  it('suggests local/linked refs inside envPriorityOrder:', async () => {
    const p = new PlanCompletionProvider(makeBridge(emptyState));
    const items = await p.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['envPriorityOrder:', '  - ']),
      pos(1, 4),
      fakeToken,
      fakeCtx,
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain('local');
    expect(labels).toContain('linked');
  });

  it('suggests true/false on enabled: lines', async () => {
    const p = new PlanCompletionProvider(makeBridge(emptyState));
    const items = await p.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['  - enabled: ']),
      pos(0, 12),
      fakeToken,
      fakeCtx,
    );
    expect(items.map((i) => i.label)).toEqual(['true', 'false']);
  });

  it('suggests workspace request ids on requestId: lines', async () => {
    const bridge = makeBridge({
      collections: {
        requests: {
          'req-1': { id: 'req-1', name: 'Login', method: 'POST' },
          'req-2': { id: 'req-2', name: 'Logout', method: 'POST' },
        },
      },
      environments: { items: {} },
    });
    const p = new PlanCompletionProvider(bridge);
    const items = await p.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['  - requestId: ']),
      pos(0, 14),
      fakeToken,
      fakeCtx,
    );
    expect(items.map((i) => i.label).sort()).toEqual(['req-1', 'req-2']);
    expect((items[0] as { detail?: string }).detail).toContain('Login');
  });

  it('suggests env names on local: lines', async () => {
    const bridge = makeBridge({
      collections: { requests: {} },
      environments: {
        items: {
          prod: { name: 'prod', variables: [] },
          staging: { name: 'staging', variables: [] },
        },
      },
    });
    const p = new PlanCompletionProvider(bridge);
    const items = await p.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['  - local: ']),
      pos(0, 10),
      fakeToken,
      fakeCtx,
    );
    expect(items.map((i) => i.label).sort()).toEqual(['prod', 'staging']);
  });

  it('returns [] when no workspace is active for value-position requests', async () => {
    const bridge = { activeWorkspace: () => undefined } as unknown as VsCodeBridge;
    const p = new PlanCompletionProvider(bridge);
    const items = await p.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/plans/p1.yaml'), ['  - requestId: ']),
      pos(0, 14),
      fakeToken,
      fakeCtx,
    );
    expect(items).toEqual([]);
  });

  // Avoid unused-vi-import warning
  void vi;
});
