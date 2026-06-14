import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type * as vscode from 'vscode';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import * as core from '@apicircle/core';
import { OAuth2TokenError } from '@apicircle/core';
import { parseAuthBlock, fetchOAuth2TokenCommand } from './fetchOAuth2Token';

function makeDoc(lines: string[]): vscode.TextDocument {
  return {
    lineCount: lines.length,
    getText: () => lines.join('\n'),
    lineAt: (line: number) => ({
      text: lines[line] ?? '',
      range: {
        start: { line, character: 0 },
        end: { line, character: (lines[line] ?? '').length },
      },
    }),
  } as unknown as vscode.TextDocument;
}

describe('parseAuthBlock', () => {
  it('returns null when auth: is absent', () => {
    expect(parseAuthBlock(makeDoc(['name: x', 'method: GET']))).toBeNull();
  });

  it('captures every nested key/value with the line number', () => {
    const doc = makeDoc([
      'name: x',
      'auth:',
      '  type: oauth2-client-credentials',
      `  tokenUrl: 'https://idp.example.com/oauth/token'`,
      `  clientId: 'app'`,
      `  clientSecret: 's3cret'`,
      `  scope: 'read write'`,
    ]);
    const parsed = parseAuthBlock(doc);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('oauth2-client-credentials');
    expect(parsed!.values.tokenUrl).toBe('https://idp.example.com/oauth/token');
    expect(parsed!.values.clientId).toBe('app');
    expect(parsed!.values.scope).toBe('read write');
    expect(parsed!.fieldLines.tokenUrl).toBe(3);
    expect(parsed!.fieldLines.clientSecret).toBe(5);
  });

  it('stops at the next top-level key', () => {
    const doc = makeDoc(['auth:', `  type: 'bearer'`, `  token: 'ABC'`, 'body:', '  type: json']);
    const parsed = parseAuthBlock(doc);
    expect(parsed!.values.token).toBe('ABC');
    // The body section is excluded from the auth parse.
    expect(parsed!.values.type).toBeUndefined();
  });
});

const reqUri = Uri.parse('apicircle://w/requests/r.yaml');

function makeDocWithUri(uri: Uri, lines: string[]) {
  return {
    uri,
    lineCount: lines.length,
    getText: () => lines.join('\n'),
    lineAt: (line: number) => ({
      text: lines[line] ?? '',
      range: {
        start: { line, character: 0 },
        end: { line, character: (lines[line] ?? '').length },
      },
    }),
  } as unknown as vscode.TextDocument;
}

function reset(): void {
  (window.showInformationMessage as Mock).mockReset();
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (workspace.openTextDocument as Mock).mockReset();
  (workspace.applyEdit as Mock).mockReset();
  window.activeTextEditor = undefined as unknown;
  vi.restoreAllMocks();
}

describe('fetchOAuth2TokenCommand', () => {
  beforeEach(reset);

  it('warns when no URI is in focus', async () => {
    await fetchOAuth2TokenCommand();
    expect(window.showWarningMessage).toHaveBeenCalledWith('No request YAML is active.');
  });

  it('warns on a non-apicircle URI', async () => {
    await fetchOAuth2TokenCommand(Uri.parse('file:///x.yaml'));
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('only runs against APICircle request or folder YAML files'),
    );
  });

  it('warns when the YAML auth type is not an OAuth2 grant', async () => {
    const doc = makeDocWithUri(reqUri, ['auth:', '  type: bearer', '  token: x']);
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    await fetchOAuth2TokenCommand(reqUri);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Switch to an OAuth2 grant first'),
    );
  });

  it('shows the redirect-required modal for oauth2-auth-code', async () => {
    const doc = makeDocWithUri(reqUri, ['auth:', '  type: oauth2-auth-code']);
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    await fetchOAuth2TokenCommand(reqUri);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('browser callback'),
      { modal: true },
    );
  });

  it('shows the redirect-required modal for oauth2-pkce', async () => {
    const doc = makeDocWithUri(reqUri, ['auth:', '  type: oauth2-pkce']);
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    await fetchOAuth2TokenCommand(reqUri);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('browser callback'),
      { modal: true },
    );
  });

  it('shows the desktop-only modal for oauth2-device', async () => {
    const doc = makeDocWithUri(reqUri, ['auth:', '  type: oauth2-device']);
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    await fetchOAuth2TokenCommand(reqUri);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Device code grant'),
      { modal: true },
    );
  });

  it('errors when tokenUrl or clientId are missing', async () => {
    const doc = makeDocWithUri(reqUri, ['auth:', '  type: oauth2-client-credentials']);
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    await fetchOAuth2TokenCommand(reqUri);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('tokenUrl and auth.clientId are required'),
    );
  });

  it('fetches a token (client_credentials) and writes the auth fields back', async () => {
    const lines = [
      'auth:',
      '  type: oauth2-client-credentials',
      "  tokenUrl: 'https://idp/token'",
      "  clientId: 'app'",
      "  clientSecret: 'sec'",
      "  scope: 'read'",
    ];
    const doc = makeDocWithUri(reqUri, lines);
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    (workspace.applyEdit as Mock).mockResolvedValue(true);
    const spy = vi.spyOn(core, 'fetchOAuth2Token').mockResolvedValue({
      accessToken: 'at-1',
      tokenType: 'Bearer',
      expiresIn: 3600,
      refreshToken: 'rt-1',
      scope: 'read',
    } as never);
    await fetchOAuth2TokenCommand(reqUri);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenUrl: 'https://idp/token',
        clientId: 'app',
        clientSecret: 'sec',
        clientAuthMethod: 'header',
      }),
    );
    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('OAuth2 token received'),
    );
  });

  it('uses the password grant body when type is oauth2-password', async () => {
    const lines = [
      'auth:',
      '  type: oauth2-password',
      "  tokenUrl: 'https://idp/token'",
      "  clientId: 'app'",
      "  username: 'u'",
      "  password: 'p'",
    ];
    const doc = makeDocWithUri(reqUri, lines);
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    (workspace.applyEdit as Mock).mockResolvedValue(true);
    const spy = vi.spyOn(core, 'fetchOAuth2Token').mockResolvedValue({
      accessToken: 'at-2',
      tokenType: 'Bearer',
      expiresIn: 600,
    } as never);
    await fetchOAuth2TokenCommand(reqUri);
    const passedBody = spy.mock.calls[0][0].body;
    expect(passedBody.get('grant_type')).toBe('password');
    expect(passedBody.get('username')).toBe('u');
    expect(passedBody.get('password')).toBe('p');
  });

  it('surfaces an OAuth2TokenError with the IdP error body', async () => {
    const lines = [
      'auth:',
      '  type: oauth2-client-credentials',
      "  tokenUrl: 'https://idp/token'",
      "  clientId: 'app'",
    ];
    const doc = makeDocWithUri(reqUri, lines);
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    vi.spyOn(core, 'fetchOAuth2Token').mockImplementation(() => {
      throw new OAuth2TokenError({
        status: 400,
        error: 'invalid_client',
        errorDescription: 'bad creds',
      } as never);
    });
    await fetchOAuth2TokenCommand(reqUri);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/invalid_client.*HTTP 400.*bad creds/),
    );
  });

  it('surfaces a generic error message on non-OAuth2TokenError failures', async () => {
    const lines = [
      'auth:',
      '  type: oauth2-client-credentials',
      "  tokenUrl: 'https://idp/token'",
      "  clientId: 'app'",
    ];
    const doc = makeDocWithUri(reqUri, lines);
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    vi.spyOn(core, 'fetchOAuth2Token').mockImplementation(() => {
      throw new Error('network down');
    });
    await fetchOAuth2TokenCommand(reqUri);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Token fetch failed: network down'),
    );
  });

  it('surfaces an error when applyEdit returns false', async () => {
    const lines = [
      'auth:',
      '  type: oauth2-client-credentials',
      "  tokenUrl: 'https://idp/token'",
      "  clientId: 'app'",
    ];
    const doc = makeDocWithUri(reqUri, lines);
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    (workspace.applyEdit as Mock).mockResolvedValue(false);
    vi.spyOn(core, 'fetchOAuth2Token').mockResolvedValue({
      accessToken: 'at',
      tokenType: 'Bearer',
      expiresIn: 60,
    } as never);
    await fetchOAuth2TokenCommand(reqUri);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to write tokens back'),
    );
  });
});
