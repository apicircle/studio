import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { RequestCompletionProvider } from './requestCompletion';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;
const fakeCtx = {} as unknown as vscode.CompletionContext;

function pos(line: number, ch: number): vscode.Position {
  return { line, character: ch } as unknown as vscode.Position;
}

describe('RequestCompletionProvider', () => {
  const provider = new RequestCompletionProvider();

  it('returns [] for non-apicircle docs', () => {
    const doc = makeDoc(Uri.parse('file:///foo.yaml'), ['method: ']);
    expect(provider.provideCompletionItems(doc, pos(0, 8), fakeToken, fakeCtx)).toEqual([]);
  });

  it('returns [] for apicircle docs that are not .yaml', () => {
    const doc = makeDoc(Uri.parse('apicircle://x/responses/r.yaml'), ['method: ']);
    expect(provider.provideCompletionItems(doc, pos(0, 8), fakeToken, fakeCtx)).toEqual([]);
  });

  it('completes HTTP methods on `method:` line at root', () => {
    const doc = makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), ['method: ']);
    const items = provider.provideCompletionItems(doc, pos(0, 8), fakeToken, fakeCtx);
    expect(items.map((i) => i.label)).toEqual([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
    ]);
  });

  it('completes auth types on `auth.type:` line', () => {
    const doc = makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
      'name: x',
      'method: GET',
      'url: https://x.com',
      'auth:',
      '  type: ',
    ]);
    const items = provider.provideCompletionItems(doc, pos(4, 8), fakeToken, fakeCtx);
    expect(items.map((i) => i.label)).toContain('bearer');
    expect(items.map((i) => i.label)).toContain('oauth2-pkce');
    expect(items.map((i) => i.label)).toContain('aws-sigv4');
    expect(items.length).toBe(17);
  });

  it('completes body types on `body.type:` line', () => {
    const doc = makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
      'name: x',
      'method: POST',
      'url: https://x.com',
      'body:',
      '  type: ',
    ]);
    const items = provider.provideCompletionItems(doc, pos(4, 8), fakeToken, fakeCtx);
    expect(items.map((i) => i.label)).toContain('json');
    expect(items.map((i) => i.label)).toContain('form-data');
  });

  it('completes assertion kinds in assertions block', () => {
    const doc = makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
      'name: x',
      'method: GET',
      'url: https://x.com',
      'assertions:',
      '  - kind: ',
    ]);
    const items = provider.provideCompletionItems(doc, pos(4, 11), fakeToken, fakeCtx);
    expect(items.map((i) => i.label)).toEqual(['status', 'header', 'json-path', 'duration']);
  });

  it('completes assertion ops in assertions block', () => {
    const doc = makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
      'name: x',
      'method: GET',
      'url: https://x.com',
      'assertions:',
      '  - kind: status',
      '    op: ',
    ]);
    const items = provider.provideCompletionItems(doc, pos(5, 8), fakeToken, fakeCtx);
    expect(items.map((i) => i.label)).toEqual([
      'equals',
      'not-equals',
      'contains',
      'lt',
      'gt',
      'matches',
    ]);
  });

  it('completes extraction sources in extractions block', () => {
    const doc = makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
      'name: x',
      'method: GET',
      'url: https://x.com',
      'extractions:',
      '  - source: ',
    ]);
    const items = provider.provideCompletionItems(doc, pos(4, 13), fakeToken, fakeCtx);
    expect(items.map((i) => i.label)).toEqual(['body', 'header', 'cookie', 'status']);
  });

  it('does NOT complete `type:` at root level (avoid colliding with auth/body)', () => {
    const doc = makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), ['type: ']);
    const items = provider.provideCompletionItems(doc, pos(0, 6), fakeToken, fakeCtx);
    expect(items).toEqual([]);
  });

  it('returns [] for lines that do not match any trigger pattern', () => {
    const doc = makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), ['name: ']);
    expect(provider.provideCompletionItems(doc, pos(0, 6), fakeToken, fakeCtx)).toEqual([]);
  });
});
