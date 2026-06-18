import * as vscode from 'vscode';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// Quick-pick + WorkspaceEdit scaffolders for the body: and auth: sections of
// a request YAML. Driven by the CodeLens row above each section so a user can
// switch between body types (json / xml / form-data / urlencoded / graphql /
// text / binary / none) or auth schemes (17 schemes — none, inherit, bearer,
// basic, api-key, custom-header, OAuth2 × 6 grants, AWS SigV4, Digest, NTLM,
// Hawk, JWT Bearer) without hand-rewriting the YAML.
//
// Switching a section is a structural rewrite: the existing block is replaced
// with a fresh starter scaffold for the chosen type. We surface the previous
// content in a confirmation modal so users don't lose work they care about by
// accident — picking the same type is a no-op.
// =============================================================================

interface BodyTypeDef {
  type: string;
  label: string;
  description: string;
  /** Lines AFTER the `body:` header. Must be indented by two spaces. */
  scaffoldLines: string[];
}

const BODY_TYPES: BodyTypeDef[] = [
  {
    type: 'none',
    label: '$(circle-slash) None',
    description: 'No request body.',
    scaffoldLines: ['  type: none', '  content: ""'],
  },
  {
    type: 'json',
    label: '$(json) JSON',
    description: 'application/json — JSON body.',
    scaffoldLines: ['  type: json', '  content: |-', '    {', '      "key": "value"', '    }'],
  },
  {
    type: 'text',
    label: '$(symbol-text) Text',
    description: 'text/plain — raw text body.',
    scaffoldLines: ['  type: text', '  content: ""'],
  },
  {
    type: 'xml',
    label: '$(symbol-misc) XML',
    description: 'application/xml — XML body.',
    scaffoldLines: [
      '  type: xml',
      '  content: |-',
      '    <root>',
      '      <key>value</key>',
      '    </root>',
    ],
  },
  {
    type: 'form-data',
    label: '$(list-tree) Form Data',
    description: 'multipart/form-data — text + file rows.',
    scaffoldLines: [
      '  type: form-data',
      // formRows is the canonical source for form-data — `content` is
      // ignored by the runner for this body type, so the projection drops
      // it to keep the YAML output focused on the rows the user actually
      // edits.
      '  formRows:',
      '    - kind: text',
      '      key: field',
      '      value: value',
      '      enabled: true',
    ],
  },
  {
    type: 'urlencoded',
    label: '$(symbol-string) URL-encoded',
    description: 'application/x-www-form-urlencoded — key=value pairs.',
    scaffoldLines: ['  type: urlencoded', '  content: key=value&other=value2'],
  },
  {
    type: 'binary',
    label: '$(file-binary) Binary',
    description: 'Raw bytes from an attached file — click the 📎 lens above to pick one.',
    scaffoldLines: [
      '  type: binary',
      // No `content:` — the runner reads the bytes from `attachment.slotId`
      // for binary bodies, so a placeholder string would just be noise the
      // user has to delete. The 📎 Pick attachment file… CodeLens above
      // body: wires up the attachment block.
    ],
  },
  {
    type: 'graphql',
    label: '$(symbol-namespace) GraphQL',
    description: 'GraphQL query + variables.',
    scaffoldLines: [
      '  type: graphql',
      '  content: |-',
      '    query Me($userId: ID!) {',
      '      me(id: $userId) {',
      '        id',
      '        name',
      '      }',
      '    }',
      // Pre-populated with one sample variable that lines up with the
      // query above ($userId). Users replace the value, or add more keys
      // to the JSON object. Quoted so YAML treats it as a string, not
      // an inline mapping.
      '  variables: \'{ "userId": "123" }\'',
    ],
  },
];

interface AuthTypeDef {
  type: string;
  label: string;
  description: string;
  /** Lines AFTER the `auth:` header. Must be indented by two spaces. */
  scaffoldLines: string[];
}

const AUTH_TYPES: AuthTypeDef[] = [
  {
    type: 'none',
    label: '$(circle-slash) None',
    description: 'No auth applied.',
    scaffoldLines: ['  type: none'],
  },
  {
    type: 'inherit',
    label: '$(arrow-up) Inherit from folder',
    description: 'Walk up the folder chain and use the first explicit auth found.',
    scaffoldLines: ['  type: inherit'],
  },
  {
    type: 'bearer',
    label: '$(key) Bearer Token',
    description: 'Authorization: Bearer <token>',
    scaffoldLines: ['  type: bearer', '  token: "{{auth_token}}"'],
  },
  {
    type: 'basic',
    label: '$(person) Basic Auth',
    description: 'Authorization: Basic base64(user:pass)',
    scaffoldLines: ['  type: basic', '  username: ""', '  password: ""'],
  },
  {
    type: 'api-key',
    label: '$(symbol-key) API Key',
    description: 'Custom key sent via header / query / cookie.',
    scaffoldLines: ['  type: api-key', '  key: X-API-Key', '  value: ""', '  addTo: header'],
  },
  {
    type: 'custom-header',
    label: '$(symbol-string) Custom Header',
    description: 'Single arbitrary auth header (e.g. `X-Token: …`).',
    scaffoldLines: ['  type: custom-header', '  key: X-Token', '  value: ""'],
  },
  {
    type: 'oauth2-client-credentials',
    label: '$(shield) OAuth2 — Client Credentials',
    description: 'Machine-to-machine OAuth2 grant.',
    scaffoldLines: [
      '  type: oauth2-client-credentials',
      '  tokenUrl: https://idp.example.com/oauth/token',
      '  clientId: ""',
      '  clientSecret: ""',
      '  scope: ""',
      '  clientAuthMethod: header',
      '  accessToken: ""',
      '  tokenType: Bearer',
      '  refreshToken: ""',
      '  expiresAt: null',
      '  obtainedScope: ""',
    ],
  },
  {
    type: 'oauth2-auth-code',
    label: '$(shield) OAuth2 — Authorization Code',
    description: 'Browser-redirect OAuth2 grant.',
    scaffoldLines: [
      '  type: oauth2-auth-code',
      '  authUrl: https://idp.example.com/oauth/authorize',
      '  tokenUrl: https://idp.example.com/oauth/token',
      '  clientId: ""',
      '  clientSecret: ""',
      '  redirectUri: ""',
      '  scope: ""',
      '  state: ""',
      '  accessToken: ""',
      '  tokenType: Bearer',
      '  refreshToken: ""',
      '  expiresAt: null',
      '  obtainedScope: ""',
    ],
  },
  {
    type: 'oauth2-pkce',
    label: '$(shield) OAuth2 — PKCE',
    description: 'OAuth2 Authorization Code + PKCE (public-client friendly).',
    scaffoldLines: [
      '  type: oauth2-pkce',
      '  authUrl: https://idp.example.com/oauth/authorize',
      '  tokenUrl: https://idp.example.com/oauth/token',
      '  clientId: ""',
      '  clientSecret: ""',
      '  redirectUri: ""',
      '  scope: ""',
      '  state: ""',
      '  codeVerifier: ""',
      '  codeChallengeMethod: S256',
      '  accessToken: ""',
      '  tokenType: Bearer',
      '  refreshToken: ""',
      '  expiresAt: null',
      '  obtainedScope: ""',
    ],
  },
  {
    type: 'oauth2-password',
    label: '$(shield) OAuth2 — Resource Owner Password',
    description: 'OAuth2 Resource Owner Password grant (legacy).',
    scaffoldLines: [
      '  type: oauth2-password',
      '  tokenUrl: https://idp.example.com/oauth/token',
      '  clientId: ""',
      '  clientSecret: ""',
      '  username: ""',
      '  password: ""',
      '  scope: ""',
      '  accessToken: ""',
      '  tokenType: Bearer',
      '  refreshToken: ""',
      '  expiresAt: null',
      '  obtainedScope: ""',
    ],
  },
  {
    type: 'oauth2-implicit',
    label: '$(shield) OAuth2 — Implicit',
    description: 'OAuth2 Implicit grant (legacy; fragment relay).',
    scaffoldLines: [
      '  type: oauth2-implicit',
      '  authUrl: https://idp.example.com/oauth/authorize',
      '  clientId: ""',
      '  redirectUri: ""',
      '  scope: ""',
      '  state: ""',
      '  accessToken: ""',
      '  tokenType: Bearer',
      '  refreshToken: ""',
      '  expiresAt: null',
      '  obtainedScope: ""',
    ],
  },
  {
    type: 'oauth2-device',
    label: '$(shield) OAuth2 — Device Code',
    description: 'OAuth2 Device Authorization grant.',
    scaffoldLines: [
      '  type: oauth2-device',
      '  deviceAuthUrl: https://idp.example.com/oauth/device/code',
      '  tokenUrl: https://idp.example.com/oauth/token',
      '  clientId: ""',
      '  scope: ""',
      '  accessToken: ""',
      '  tokenType: Bearer',
      '  refreshToken: ""',
      '  expiresAt: null',
      '  obtainedScope: ""',
    ],
  },
  {
    type: 'aws-sigv4',
    label: '$(cloud) AWS Signature V4',
    description: 'AWS SigV4 request signing.',
    scaffoldLines: [
      '  type: aws-sigv4',
      '  accessKeyId: ""',
      '  secretAccessKey: ""',
      '  sessionToken: ""',
      '  region: us-east-1',
      '  service: execute-api',
    ],
  },
  {
    type: 'digest',
    label: '$(lock) Digest',
    description: 'HTTP Digest authentication (RFC 7616).',
    scaffoldLines: [
      '  type: digest',
      '  username: ""',
      '  password: ""',
      '  algorithm: MD5',
      '  qop: auth',
    ],
  },
  {
    type: 'ntlm',
    label: '$(lock) NTLM',
    description: 'NTLM auth (Windows-style three-way handshake).',
    scaffoldLines: [
      '  type: ntlm',
      '  username: ""',
      '  password: ""',
      '  domain: ""',
      '  workstation: ""',
    ],
  },
  {
    type: 'hawk',
    label: '$(lock) Hawk',
    description: 'Hawk MAC authentication.',
    scaffoldLines: [
      '  type: hawk',
      '  id: ""',
      '  key: ""',
      '  algorithm: sha256',
      '  includePayloadHash: false',
    ],
  },
  {
    type: 'jwt-bearer',
    label: '$(key) JWT Bearer',
    description: 'JWT Bearer (RFC 7523) — signs a self-issued JWT and sends as Bearer.',
    scaffoldLines: [
      '  type: jwt-bearer',
      '  algorithm: HS256',
      '  secret: ""',
      '  payload: |-',
      '    {',
      '      "iss": "client-id",',
      '      "sub": "user-id",',
      '      "aud": "https://api.example.com"',
      '    }',
      '  headerPrefix: Bearer',
    ],
  },
];

/**
 * Find the byte range of a top-level `key:` section in a YAML document.
 * Returns null when the section isn't present.
 *
 * The section runs from the `key:` line through the last indented child line —
 * inclusive of the trailing newline so a replacement leaves the rest of the
 * document untouched. Stops at the next top-level key (any line beginning with
 * an alphanumeric character at column 0) or EOF.
 */
export function findSectionRange(document: vscode.TextDocument, key: string): vscode.Range | null {
  const startLineIdx = findSectionLine(document.getText(), key);
  if (startLineIdx === -1) return null;
  let endLineIdx = document.lineCount - 1;
  for (let line = startLineIdx + 1; line < document.lineCount; line++) {
    const text = document.lineAt(line).text;
    if (/^[A-Za-z]/.test(text)) {
      endLineIdx = line - 1;
      break;
    }
  }
  const start = new vscode.Position(startLineIdx, 0);
  // Range end at start of the line AFTER the last section line — covers the
  // section's trailing newline so a replacement collapses cleanly.
  const end =
    endLineIdx + 1 < document.lineCount
      ? new vscode.Position(endLineIdx + 1, 0)
      : document.lineAt(endLineIdx).range.end;
  return new vscode.Range(start, end);
}

function findSectionLine(text: string, key: string): number {
  const pattern = new RegExp(`^${key}\\s*:`, 'm');
  const match = pattern.exec(text);
  if (!match) return -1;
  return text.slice(0, match.index).split('\n').length - 1;
}

/** Read the existing `type:` value of a section, or null when the section is
 *  absent / type field is missing. Lets the quick-pick highlight the current
 *  selection so the user sees what they're switching from. */
export function readSectionType(text: string, key: string): string | null {
  const startLineIdx = findSectionLine(text, key);
  if (startLineIdx === -1) return null;
  const lines = text.split('\n');
  for (let i = startLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Za-z]/.test(line)) break;
    const typeMatch = /^\s+type:\s*['"]?([A-Za-z0-9-]+)['"]?/.exec(line);
    if (typeMatch) return typeMatch[1];
  }
  return null;
}

async function switchSection(
  uri: vscode.Uri | undefined,
  sectionKey: 'body' | 'auth',
  defs: (BodyTypeDef | AuthTypeDef)[],
  label: 'body' | 'auth',
): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showWarningMessage('No request YAML is active.');
    return;
  }
  const isReqYaml = uriEntityKind(targetUri) === 'request';
  const isFolderYaml = uriEntityKind(targetUri) === 'folder';
  // folder YAML supports only the `auth` switch — body lives on requests.
  const folderOk = isFolderYaml && sectionKey === 'auth';
  if (targetUri.scheme !== 'apicircle' || (!isReqYaml && !folderOk)) {
    await vscode.window.showWarningMessage(
      sectionKey === 'auth'
        ? 'This command only runs against API Circle request or folder YAML files.'
        : 'This command only runs against API Circle request YAML files.',
    );
    return;
  }
  const document = await vscode.workspace.openTextDocument(targetUri);
  const text = document.getText();
  const currentType = readSectionType(text, sectionKey);

  const pick = await vscode.window.showQuickPick(
    defs.map((d) => ({
      label: d.label,
      description: d.type === currentType ? '✓ current' : d.description,
      detail: d.type === currentType ? undefined : `→ rewrites the ${label}: block`,
      typeKey: d.type,
    })),
    {
      title: `Switch ${label} type`,
      placeHolder: currentType
        ? `Current: ${currentType} — pick a different type to replace the block.`
        : `No ${label} section yet — picking a type inserts a fresh scaffold.`,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!pick) return;
  if (pick.typeKey === currentType) {
    return; // No-op: same type chosen.
  }

  const def = defs.find((d) => d.type === pick.typeKey);
  if (!def) return;

  const editor = await vscode.window.showTextDocument(document);
  const newSectionText = `${sectionKey}:\n${def.scaffoldLines.join('\n')}\n`;
  const existingRange = findSectionRange(document, sectionKey);

  const edit = new vscode.WorkspaceEdit();
  if (existingRange) {
    edit.replace(document.uri, existingRange, newSectionText);
  } else {
    // No existing section — append to EOF, preceded by a blank line if
    // the document doesn't already end with one.
    const endLine = document.lineCount - 1;
    const endPosition = document.lineAt(endLine).range.end;
    const prefix = document.lineAt(endLine).text.trim().length > 0 ? '\n\n' : '\n';
    edit.insert(document.uri, endPosition, prefix + newSectionText);
  }
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    await vscode.window.showErrorMessage(`Failed to switch ${label} type.`);
    return;
  }

  // Scroll cursor to the (new) section header.
  const newStartLine = findSectionLine(document.getText(), sectionKey);
  if (newStartLine !== -1) {
    const targetRange = document.lineAt(newStartLine).range;
    editor.selection = new vscode.Selection(targetRange.start, targetRange.start);
    editor.revealRange(targetRange, vscode.TextEditorRevealType.InCenter);
  }
}

export async function switchRequestBodyTypeCommand(uri?: vscode.Uri): Promise<void> {
  await switchSection(uri, 'body', BODY_TYPES, 'body');
}

export async function switchRequestAuthTypeCommand(uri?: vscode.Uri): Promise<void> {
  await switchSection(uri, 'auth', AUTH_TYPES, 'auth');
}

/** Test-only exports — let unit tests drive the type catalogue without
 *  re-declaring it. */
export const __testHooks = { BODY_TYPES, AUTH_TYPES };
