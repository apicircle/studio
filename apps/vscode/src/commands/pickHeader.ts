import * as vscode from 'vscode';
import { findSectionRange } from './switchRequestSection';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// `apicircle.pickHeader` — driven by the CodeLens above `headers:` in a
// request YAML. Two-step quick-pick:
//
//   Step 1: pick a header name from a curated list of common HTTP request
//           headers (Accept, Authorization, Content-Type, …). User can also
//           pick "✏ Custom header name…" to free-type one.
//   Step 2: when the picked header has a known value catalogue (e.g. Accept
//           offers application/json / application/xml / text/csv), a second
//           quick-pick narrows the value. Otherwise an input box collects it.
//
// The chosen { name, value } row is appended to the `headers:` list — or the
// `headers:` section is created at the bottom of the document if absent.
// =============================================================================

interface HeaderDef {
  /** Canonical header name (capitalisation matters for display; HTTP itself is case-insensitive). */
  name: string;
  /** One-line hint shown in the picker. */
  description: string;
  /** Common values offered in the value-picker. Empty → input box only. */
  values: string[];
}

// Curated catalogue. Kept tight on purpose — 16 entries covers ~95 % of
// real-world hand-written headers. Anything else goes through the
// "Custom header name…" free-type path.
const HEADERS: HeaderDef[] = [
  {
    name: 'Accept',
    description: 'Media types the client will accept.',
    values: [
      'application/json',
      'application/xml',
      'application/yaml',
      'application/octet-stream',
      'text/plain',
      'text/csv',
      'text/html',
      '*/*',
    ],
  },
  {
    name: 'Accept-Encoding',
    description: 'Compression algorithms the client supports.',
    values: ['gzip, deflate, br', 'identity', 'gzip', 'deflate', 'br'],
  },
  {
    name: 'Accept-Language',
    description: 'Preferred natural languages.',
    values: ['en-US', 'en', 'en-US,en;q=0.9', 'fr', 'de', 'ja', 'zh-CN'],
  },
  {
    name: 'Authorization',
    description: 'Auth credentials (consider using the auth: block instead).',
    values: ['Bearer {{auth_token}}', 'Basic {{base64_credentials}}', 'Token {{api_token}}'],
  },
  {
    name: 'Cache-Control',
    description: 'Caching directives.',
    values: [
      'no-cache',
      'no-store',
      'no-store, no-cache, must-revalidate',
      'max-age=0',
      'max-age=3600',
      'public',
      'private',
    ],
  },
  {
    name: 'Content-Type',
    description: 'Request body media type.',
    values: [
      'application/json',
      'application/xml',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'text/plain',
      'application/octet-stream',
      'application/graphql',
    ],
  },
  {
    name: 'Cookie',
    description: 'Session cookies (consider the cookies: block instead).',
    values: [],
  },
  {
    name: 'Host',
    description: 'Authority part of the request URL (rarely needed — fetch sets this).',
    values: [],
  },
  {
    name: 'If-Match',
    description: 'Run only if the resource ETag matches.',
    values: ['*', '"{{etag}}"'],
  },
  {
    name: 'If-None-Match',
    description: 'Run only if the resource ETag does NOT match.',
    values: ['*', '"{{etag}}"'],
  },
  {
    name: 'Origin',
    description: 'CORS origin override.',
    values: ['{{base_url}}', 'https://app.example.com', 'null'],
  },
  {
    name: 'Prefer',
    description: 'Hints to the server (RFC 7240) — common in OData / SCIM / FHIR.',
    values: ['return=minimal', 'return=representation', 'handling=lenient'],
  },
  {
    name: 'Referer',
    description: 'URL the request was made from.',
    values: ['{{base_url}}'],
  },
  {
    name: 'User-Agent',
    description: 'Client identifier.',
    values: ['API Circle/1.0', 'curl/8.0.0'],
  },
  {
    name: 'X-API-Key',
    description: 'API key (consider the api-key auth scheme instead).',
    values: ['{{api_key}}'],
  },
  {
    name: 'X-Request-ID',
    description: 'Correlation id for tracing.',
    values: ['{{uuid}}'],
  },
];

const CUSTOM_HEADER_VALUE = '__custom__';

export async function pickHeaderCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showWarningMessage('No request YAML is active.');
    return;
  }
  if (targetUri.scheme !== 'apicircle' || uriEntityKind(targetUri) !== 'request') {
    await vscode.window.showWarningMessage(
      'This command only runs against API Circle request YAML files.',
    );
    return;
  }
  // Touch the document once so VS Code resolves the virtual URI to a real
  // TextDocument before we start the multi-step picker — the bulk of the
  // insert work happens against `refreshed` below, but failing fast here
  // surfaces a missing FS provider before the user spends time picking.
  await vscode.workspace.openTextDocument(targetUri);

  // Step 1: pick a header name.
  type NamePick = vscode.QuickPickItem & { value: string };
  const nameItems: NamePick[] = HEADERS.map((h) => ({
    label: h.name,
    description: h.description,
    value: h.name,
  }));
  nameItems.push({
    label: '✏ Custom header name…',
    description: 'Type any header name (e.g. X-Trace-Id).',
    value: CUSTOM_HEADER_VALUE,
  });
  const pickedName = await vscode.window.showQuickPick(nameItems, {
    title: 'Pick a header',
    placeHolder: 'Search by name — common headers are listed first.',
    matchOnDescription: true,
  });
  if (!pickedName) return;

  let headerName = pickedName.value;
  if (headerName === CUSTOM_HEADER_VALUE) {
    const typed = await vscode.window.showInputBox({
      prompt: 'Header name',
      placeHolder: 'X-Trace-Id',
      validateInput: (v) =>
        v.trim().length === 0
          ? 'Header name is required.'
          : /\s/.test(v)
            ? 'No whitespace in header names.'
            : null,
    });
    if (!typed) return;
    headerName = typed.trim();
  }

  // Step 2: pick a value. If the catalogue carries presets, offer them +
  // a "Custom value…" escape hatch. Otherwise jump straight to an input box.
  const headerDef = HEADERS.find((h) => h.name === headerName);
  let headerValue: string | undefined;
  if (headerDef && headerDef.values.length > 0) {
    type ValuePick = vscode.QuickPickItem & { value: string };
    const valueItems: ValuePick[] = headerDef.values.map((v) => ({ label: v, value: v }));
    valueItems.push({
      label: '✏ Custom value…',
      description: 'Type any string.',
      value: CUSTOM_HEADER_VALUE,
    });
    const pickedValue = await vscode.window.showQuickPick(valueItems, {
      title: `Value for ${headerName}`,
      placeHolder: 'Pick a curated value or type your own.',
    });
    if (!pickedValue) return;
    if (pickedValue.value === CUSTOM_HEADER_VALUE) {
      headerValue = await vscode.window.showInputBox({
        prompt: `Value for ${headerName}`,
        placeHolder: 'e.g. application/json',
      });
    } else {
      headerValue = pickedValue.value;
    }
  } else {
    headerValue = await vscode.window.showInputBox({
      prompt: `Value for ${headerName}`,
      placeHolder: 'Free-text value (use {{var}} for env references).',
    });
  }
  if (headerValue === undefined) return;

  const rowBlock = renderHeaderRow(headerName, headerValue);
  const refreshed = await vscode.workspace.openTextDocument(targetUri);
  const editor = await vscode.window.showTextDocument(refreshed);
  const edit = new vscode.WorkspaceEdit();
  const headersRange = findSectionRange(refreshed, 'headers');
  if (headersRange) {
    edit.insert(refreshed.uri, headersRange.end, rowBlock);
  } else {
    const endLine = refreshed.lineCount - 1;
    const endPosition = refreshed.lineAt(endLine).range.end;
    const prefix =
      refreshed.lineAt(endLine).text.trim().length > 0 ? '\n\nheaders:\n' : '\nheaders:\n';
    edit.insert(refreshed.uri, endPosition, prefix + rowBlock);
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage('Failed to insert header row.');
    return;
  }
  void editor.revealRange(
    new vscode.Range(refreshed.lineCount - 1, 0, refreshed.lineCount - 1, 0),
    vscode.TextEditorRevealType.InCenter,
  );
}

/** Render one `headers:` row entry. Two-space outer indent + four-space child
 *  indent matches `serializeRequestToYaml`'s output. */
export function renderHeaderRow(name: string, value: string): string {
  return (
    [`  - key: ${yamlString(name)}`, `    value: ${yamlString(value)}`, '    enabled: true'].join(
      '\n',
    ) + '\n'
  );
}

function yamlString(value: string): string {
  if (/[:#&*!|>'"%@`]|^[\s-]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** Test-only export — keeps the curated list assertable without exporting
 *  the live HEADERS const directly. */
export const __testHooks = { HEADERS };
