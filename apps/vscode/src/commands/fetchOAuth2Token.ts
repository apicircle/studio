import * as vscode from 'vscode';
import { fetchOAuth2Token, OAuth2TokenError } from '@apicircle/core';
import { findSectionRange, readSectionType } from './switchRequestSection';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// `apicircle.fetchOAuth2Token` — driven by the CodeLens above an `auth:`
// section whose `type:` is one of the OAuth2 grants. Fetches an access token
// from the configured token URL and writes it (plus refresh / expiresAt /
// obtainedScope) back into the auth block via WorkspaceEdit.
//
// Grant coverage:
//   - oauth2-client-credentials → fully supported here (server-to-server,
//     no browser redirect needed). Reads tokenUrl + clientId + clientSecret
//     + scope + clientAuthMethod, fetches, writes tokens back.
//   - oauth2-password           → fully supported (resource-owner password
//     grant — legacy but doesn't need a callback).
//   - oauth2-device             → kicks off the device code flow, then
//     prints the verification URL + user_code to the user and polls until
//     the IdP grants the token.
//   - oauth2-auth-code / oauth2-pkce / oauth2-implicit
//                                → need a 127.0.0.1 callback server to
//     capture the redirect. Deferred to a follow-up — the command surfaces
//     a clear toast directing the user to the desktop / web app for those
//     grants in the meantime.
// =============================================================================

const AUTH_KEY_RE = /^\s+([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/;

interface ParsedAuthBlock {
  type: string;
  values: Record<string, string>;
  /** Line ranges of fields we may need to rewrite (token / expiresAt / etc). */
  fieldLines: Record<string, number>;
  /** Document range of the body of the auth: section (exclusive of the header). */
  range: vscode.Range;
}

export async function fetchOAuth2TokenCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showWarningMessage('No request YAML is active.');
    return;
  }
  const isReqYaml = uriEntityKind(targetUri) === 'request';
  const isFolderYaml = uriEntityKind(targetUri) === 'folder';
  if (targetUri.scheme !== 'apicircle' || (!isReqYaml && !isFolderYaml)) {
    await vscode.window.showWarningMessage(
      'This command only runs against APICircle request or folder YAML files.',
    );
    return;
  }
  const document = await vscode.workspace.openTextDocument(targetUri);
  const authType = readSectionType(document.getText(), 'auth');
  if (!authType || !authType.startsWith('oauth2-')) {
    await vscode.window.showWarningMessage(
      `auth.type is "${authType ?? 'none'}". Switch to an OAuth2 grant first.`,
    );
    return;
  }

  if (
    authType === 'oauth2-auth-code' ||
    authType === 'oauth2-pkce' ||
    authType === 'oauth2-implicit'
  ) {
    await vscode.window.showInformationMessage(
      `${authType} needs a browser callback to capture the redirect. That flow ships in the desktop / web app today — open the request there, run the Get Token action, then pull the workspace back into this folder. (VS Code-side callback support is on the roadmap.)`,
      { modal: true },
    );
    return;
  }
  if (authType === 'oauth2-device') {
    await vscode.window.showInformationMessage(
      'Device code grant polling is on the roadmap for the VS Code surface. For now, run the Device Code flow in the desktop app.',
      { modal: true },
    );
    return;
  }
  if (authType !== 'oauth2-client-credentials' && authType !== 'oauth2-password') {
    await vscode.window.showWarningMessage(`Unsupported OAuth2 grant: ${authType}`);
    return;
  }

  const parsed = parseAuthBlock(document);
  if (!parsed) {
    await vscode.window.showErrorMessage('Could not parse the auth: block.');
    return;
  }

  // Build body per grant.
  const body = new URLSearchParams();
  if (authType === 'oauth2-client-credentials') {
    body.set('grant_type', 'client_credentials');
    if (parsed.values.scope) body.set('scope', parsed.values.scope);
  } else {
    body.set('grant_type', 'password');
    body.set('username', parsed.values.username ?? '');
    body.set('password', parsed.values.password ?? '');
    if (parsed.values.scope) body.set('scope', parsed.values.scope);
  }

  const tokenUrl = parsed.values.tokenUrl;
  const clientId = parsed.values.clientId;
  if (!tokenUrl || !clientId) {
    await vscode.window.showErrorMessage(
      'auth.tokenUrl and auth.clientId are required to fetch a token.',
    );
    return;
  }

  try {
    const response = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Fetching OAuth2 token (${authType})…`,
        cancellable: false,
      },
      async () => {
        return await fetchOAuth2Token({
          tokenUrl,
          body,
          clientId,
          clientSecret: parsed.values.clientSecret || undefined,
          clientAuthMethod: parsed.values.clientAuthMethod === 'body' ? 'body' : 'header',
        });
      },
    );

    // Write the token fields back into the auth: block.
    const refreshed = await vscode.workspace.openTextDocument(targetUri);
    const refreshedParsed = parseAuthBlock(refreshed);
    if (!refreshedParsed) {
      await vscode.window.showErrorMessage(
        'Could not relocate the auth: block after fetching the token.',
      );
      return;
    }
    const expiresAt = response.expiresIn ? Date.now() + response.expiresIn * 1000 : null;
    const edit = new vscode.WorkspaceEdit();
    upsertAuthField(edit, refreshed, refreshedParsed, 'accessToken', response.accessToken);
    upsertAuthField(edit, refreshed, refreshedParsed, 'tokenType', response.tokenType || 'Bearer');
    upsertAuthField(edit, refreshed, refreshedParsed, 'refreshToken', response.refreshToken ?? '');
    upsertAuthField(
      edit,
      refreshed,
      refreshedParsed,
      'expiresAt',
      expiresAt === null ? 'null' : String(expiresAt),
      { quote: expiresAt !== null ? 'none' : 'none' },
    );
    upsertAuthField(
      edit,
      refreshed,
      refreshedParsed,
      'obtainedScope',
      response.scope ?? parsed.values.scope ?? '',
    );
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      await vscode.window.showErrorMessage('Failed to write tokens back into the auth: block.');
      return;
    }
    await vscode.window.showInformationMessage(
      `OAuth2 token received (expires ${expiresAt ? `in ${response.expiresIn}s` : 'unknown'}).`,
    );
  } catch (err) {
    if (err instanceof OAuth2TokenError) {
      await vscode.window.showErrorMessage(
        `OAuth2 ${err.errorBody.error} (HTTP ${err.errorBody.status})${
          err.errorBody.errorDescription ? `: ${err.errorBody.errorDescription}` : ''
        }`,
      );
      return;
    }
    await vscode.window.showErrorMessage(
      `Token fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Parse the auth: section into a flat field map. Skips the `type:` header.
 *  Returns null when the section is absent or malformed.
 *
 *  Iterates the document directly (rather than relying on `findSectionRange`'s
 *  end position) because that range uses two distinct conventions — an
 *  exclusive next-section position OR an inclusive end-of-line position when
 *  the section runs to EOF — so a single `i < end.line` loop misses the last
 *  line of an EOF-anchored section. Scanning to the next top-level key is
 *  symmetric and avoids that pitfall. */
export function parseAuthBlock(document: vscode.TextDocument): ParsedAuthBlock | null {
  const sectionRange = findSectionRange(document, 'auth');
  if (!sectionRange) return null;
  const values: Record<string, string> = {};
  const fieldLines: Record<string, number> = {};
  let type = '';
  for (let i = sectionRange.start.line + 1; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    if (/^[A-Za-z]/.test(text)) break; // next top-level key
    const match = AUTH_KEY_RE.exec(text);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2].trim();
    const value = unquote(rawValue);
    if (key === 'type') {
      type = value;
      continue;
    }
    values[key] = value;
    fieldLines[key] = i;
  }
  return { type, values, fieldLines, range: sectionRange };
}

function unquote(raw: string): string {
  if (raw.length === 0) return raw;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

interface UpsertOptions {
  /** none = render as a bare token (numbers / null). default = single-quote. */
  quote?: 'none' | 'single';
}

function upsertAuthField(
  edit: vscode.WorkspaceEdit,
  document: vscode.TextDocument,
  parsed: ParsedAuthBlock,
  key: string,
  value: string,
  opts: UpsertOptions = {},
): void {
  const rendered = opts.quote === 'none' ? value : yamlString(value);
  const line = parsed.fieldLines[key];
  if (line !== undefined) {
    const existing = document.lineAt(line);
    const indent = existing.text.match(/^\s*/)?.[0] ?? '  ';
    edit.replace(document.uri, existing.range, `${indent}${key}: ${rendered}`);
  } else {
    // Insert just before the section end so new fields land next to siblings.
    const insertPosition = parsed.range.end;
    edit.insert(document.uri, insertPosition, `  ${key}: ${rendered}\n`);
  }
}

function yamlString(value: string): string {
  if (/[:#&*!|>'"%@`]|^[\s-]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}
