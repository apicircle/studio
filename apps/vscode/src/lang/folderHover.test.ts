import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri, Hover, Range } from '../../test/mocks/vscode';
import type { MarkdownString } from '../../test/mocks/vscode';
import { InheritAuthHoverProvider } from './folderHover';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({
      text: lines[line] ?? '',
      range: new Range(
        { line, character: 0 } as never,
        { line, character: (lines[line] ?? '').length } as never,
      ),
    }),
  } as unknown as vscode.TextDocument;
}

function position(line: number, character: number): vscode.Position {
  return { line, character } as unknown as vscode.Position;
}

function makeBridge(opts: {
  workspaceId: string;
  requests: Record<string, { folderId: string | null; auth: { type: string } }>;
  folders: Record<string, { id: string; name: string; parentId: string | null; auth?: unknown }>;
}) {
  const wsId = opts.workspaceId;
  const state = {
    synced: {
      collections: { requests: opts.requests, folders: opts.folders },
    },
    local: {},
  } as never;
  const surface = { workspace: { id: wsId }, read: async () => state };
  return { listWorkspaces: () => [surface] } as never;
}

function authority(workspaceId: string): string {
  return Buffer.from(workspaceId, 'utf8').toString('hex');
}

describe('InheritAuthHoverProvider', () => {
  it('returns null on non-apicircle documents', async () => {
    const provider = new InheritAuthHoverProvider(
      makeBridge({ workspaceId: '/x', requests: {}, folders: {} }),
    );
    const h = await provider.provideHover(
      makeDoc(Uri.parse('file:///x.yaml'), ['auth:']),
      position(0, 0),
    );
    expect(h).toBeNull();
  });

  it('resolves the inherit chain on a request YAML and names the source folder', async () => {
    const wsId = '/test/.apicircle';
    const reqId = 'req_x';
    const bridge = makeBridge({
      workspaceId: wsId,
      requests: { [reqId]: { folderId: 'fChild', auth: { type: 'inherit' } } },
      folders: {
        fParent: {
          id: 'fParent',
          name: 'Authenticated',
          parentId: null,
          auth: { type: 'bearer', token: 'tk' },
        },
        fChild: { id: 'fChild', name: 'Users', parentId: 'fParent' },
      },
    });
    const provider = new InheritAuthHoverProvider(bridge);
    const uri = Uri.parse(`apicircle://${authority(wsId)}/requests/r.yaml?id=${reqId}`);
    const hover = await provider.provideHover(
      makeDoc(uri, ['name: X', 'auth:', '  type: inherit']),
      position(1, 0),
    );
    expect(hover).toBeInstanceOf(Hover);
    const md = (hover as unknown as { contents: MarkdownString[] }).contents[0];
    expect(String(md.value)).toContain('Inherits → `bearer`');
    expect(String(md.value)).toContain('Authenticated');
  });

  it('reads → none when no ancestor sets auth', async () => {
    const wsId = '/test/.apicircle';
    const reqId = 'req_x';
    const bridge = makeBridge({
      workspaceId: wsId,
      requests: { [reqId]: { folderId: 'fA', auth: { type: 'inherit' } } },
      folders: { fA: { id: 'fA', name: 'Root', parentId: null } },
    });
    const provider = new InheritAuthHoverProvider(bridge);
    const uri = Uri.parse(`apicircle://${authority(wsId)}/requests/r.yaml?id=${reqId}`);
    const hover = await provider.provideHover(
      makeDoc(uri, ['name: X', 'auth:', '  type: inherit']),
      position(1, 0),
    );
    const md = (hover as unknown as { contents: MarkdownString[] }).contents[0];
    expect(String(md.value)).toContain('Inherits → `none`');
  });

  it('does not hover on non-auth lines', async () => {
    const provider = new InheritAuthHoverProvider(
      makeBridge({ workspaceId: '/x', requests: {}, folders: {} }),
    );
    const hover = await provider.provideHover(
      makeDoc(Uri.parse('apicircle://x/requests/r.yaml?id=req_1'), ['name: X', 'method: GET']),
      position(0, 0),
    );
    expect(hover).toBeNull();
  });

  it('previews descendant resolution + a count on folder YAML auth: line', async () => {
    const wsId = '/test/.apicircle';
    const bridge = makeBridge({
      workspaceId: wsId,
      requests: {
        req_a: { folderId: 'fChild', auth: { type: 'inherit' } },
        req_b: { folderId: 'fChild', auth: { type: 'inherit' } },
        req_c: { folderId: 'fOther', auth: { type: 'inherit' } },
        req_d: { folderId: 'fChild', auth: { type: 'bearer' } }, // not inherit — should NOT count
      },
      folders: {
        fAuthed: {
          id: 'fAuthed',
          name: 'Authenticated',
          parentId: null,
          auth: { type: 'bearer', token: 'TK' },
        },
        fChild: { id: 'fChild', name: 'Users', parentId: 'fAuthed' },
        fOther: { id: 'fOther', name: 'Other', parentId: null },
      },
    });
    const provider = new InheritAuthHoverProvider(bridge);
    const uri = Uri.parse(`apicircle://${authority(wsId)}/folders/fAuthed.yaml?id=fAuthed`);
    const hover = await provider.provideHover(
      makeDoc(uri, ['name: Authenticated', 'auth:', '  type: bearer']),
      position(1, 0),
    );
    const md = (hover as unknown as { contents: MarkdownString[] }).contents[0];
    const text = String(md.value);
    expect(text).toContain('Descendants resolve to `bearer`');
    expect(text).toContain('2 descendant request');
  });

  it('previews upstream walk when the folder itself declares inherit', async () => {
    const wsId = '/test/.apicircle';
    const bridge = makeBridge({
      workspaceId: wsId,
      requests: {},
      folders: {
        fAncestor: {
          id: 'fAncestor',
          name: 'AncestorAuth',
          parentId: null,
          auth: { type: 'bearer', token: 'TK' },
        },
        fInherit: {
          id: 'fInherit',
          name: 'PassThrough',
          parentId: 'fAncestor',
          auth: { type: 'inherit' },
        },
      },
    });
    const provider = new InheritAuthHoverProvider(bridge);
    const uri = Uri.parse(`apicircle://${authority(wsId)}/folders/x.yaml?id=fInherit`);
    const hover = await provider.provideHover(
      makeDoc(uri, ['name: PassThrough', 'auth:', '  type: inherit']),
      position(1, 0),
    );
    const md = (hover as unknown as { contents: MarkdownString[] }).contents[0];
    const text = String(md.value);
    expect(text).toContain('This folder declares `inherit`');
    expect(text).toContain('AncestorAuth');
    expect(text).toContain('bearer');
  });
});
