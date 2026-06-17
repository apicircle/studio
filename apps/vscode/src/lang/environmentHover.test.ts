import { describe, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { EnvironmentHoverProvider } from './environmentHover';
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

describe('EnvironmentHoverProvider', () => {
  const baseSynced = {
    secretKeys: {},
    environments: {
      items: {
        prod: {
          name: 'prod',
          variables: [
            { key: 'API_BASE', value: 'https://api.prod' },
            { key: 'TOKEN', value: 'enc:v1:abc:def', encrypted: true, secretKeyId: 'slot-1' },
          ],
        },
        staging: {
          name: 'staging',
          variables: [{ key: 'API_BASE', value: 'https://api.stg' }],
        },
      },
      activeName: 'prod',
      priorityOrder: [{ kind: 'local', name: 'prod' }],
    },
  };

  it('returns undefined for non-apicircle scheme', async () => {
    const provider = new EnvironmentHoverProvider(makeBridge({ synced: baseSynced }));
    const r = await provider.provideHover(
      makeDoc(Uri.parse('file:///x.yaml'), ['name: prod', '- key: API_BASE']),
      pos(1, 8),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  it('returns undefined for apicircle URIs not ending in .yaml', async () => {
    const provider = new EnvironmentHoverProvider(makeBridge({ synced: baseSynced }));
    const r = await provider.provideHover(
      makeDoc(Uri.parse('apicircle://x/requests/r.yaml'), ['- key: API_BASE']),
      pos(0, 8),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  it('returns undefined when the line is not a key: line', async () => {
    const provider = new EnvironmentHoverProvider(makeBridge({ synced: baseSynced }));
    const r = await provider.provideHover(
      makeDoc(Uri.parse('apicircle://x/environments/prod.yaml'), ['name: prod', 'variables:']),
      pos(1, 0),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  it('returns undefined when no workspace is active', async () => {
    const bridge = { activeWorkspace: () => undefined } as unknown as VsCodeBridge;
    const provider = new EnvironmentHoverProvider(bridge);
    const r = await provider.provideHover(
      makeDoc(Uri.parse('apicircle://x/environments/prod.yaml'), ['name: prod', '- key: API_BASE']),
      pos(1, 8),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  it('renders plaintext value + active-resolution for an active env', async () => {
    const provider = new EnvironmentHoverProvider(makeBridge({ synced: baseSynced }));
    const r = await provider.provideHover(
      makeDoc(Uri.parse('apicircle://x/environments/prod.yaml'), ['name: prod', '- key: API_BASE']),
      pos(1, 8),
      fakeToken,
    );
    expect(r).toBeDefined();
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('API_BASE');
    expect(md.value).toContain('Plaintext');
    expect(md.value).toContain('https://api.prod');
    expect(md.value).toContain('active environment');
  });

  it('shows secret slot id + label for encrypted variables', async () => {
    const synced = {
      ...baseSynced,
      secretKeys: { 'slot-1': { id: 'slot-1', label: 'Prod token', createdAt: '2026-01-01' } },
    };
    const provider = new EnvironmentHoverProvider(makeBridge({ synced }));
    const r = await provider.provideHover(
      makeDoc(Uri.parse('apicircle://x/environments/prod.yaml'), ['name: prod', '- key: TOKEN']),
      pos(1, 8),
      fakeToken,
    );
    expect(r).toBeDefined();
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('Encrypted');
    expect(md.value).toContain('slot-1');
    expect(md.value).toContain('Prod token');
  });

  it('warns when an encrypted variable references a missing slot', async () => {
    const provider = new EnvironmentHoverProvider(makeBridge({ synced: baseSynced }));
    const r = await provider.provideHover(
      makeDoc(Uri.parse('apicircle://x/environments/prod.yaml'), ['name: prod', '- key: TOKEN']),
      pos(1, 8),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('vault entry missing');
  });

  it('shows mask warning when a higher-priority env defines the same key', async () => {
    const synced = {
      ...baseSynced,
      environments: {
        ...baseSynced.environments,
        priorityOrder: [
          { kind: 'local', name: 'staging' },
          { kind: 'local', name: 'prod' },
        ],
        activeName: 'staging',
      },
    };
    const provider = new EnvironmentHoverProvider(makeBridge({ synced }));
    const r = await provider.provideHover(
      makeDoc(Uri.parse('apicircle://x/environments/prod.yaml'), ['name: prod', '- key: API_BASE']),
      pos(1, 8),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('Masked');
    expect(md.value).toContain('staging');
  });

  it('flags an env that is not in the priority order', async () => {
    const synced = {
      ...baseSynced,
      environments: { ...baseSynced.environments, priorityOrder: [], activeName: null },
    };
    const provider = new EnvironmentHoverProvider(makeBridge({ synced }));
    const r = await provider.provideHover(
      makeDoc(Uri.parse('apicircle://x/environments/prod.yaml'), ['name: prod', '- key: API_BASE']),
      pos(1, 8),
      fakeToken,
    );
    const md = (r as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toContain('not in the active priority order');
  });

  it('returns undefined for keys not present in the env', async () => {
    // Hover on a key that exists in the document but not in the env data
    const synced = {
      ...baseSynced,
      environments: {
        ...baseSynced.environments,
        items: {
          prod: { name: 'prod', variables: [{ key: 'API_BASE', value: 'x' }] },
        },
      },
    };
    const provider = new EnvironmentHoverProvider(makeBridge({ synced }));
    const r = await provider.provideHover(
      makeDoc(Uri.parse('apicircle://x/environments/prod.yaml'), [
        'name: prod',
        '- key: NOT_THERE',
      ]),
      pos(1, 8),
      fakeToken,
    );
    expect(r).toBeUndefined();
  });

  // Avoid `vi.fn()` import warning
  void vi;
});
