import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// Phase 11 — Mock endpoint visual editor (webview MVP).
//
// Form-based editor for a single mock endpoint, surfaced from the MockView's
// per-endpoint context menu. The webview is OPT-IN — YAML editing remains the
// primary path. This serves the "I just want to change the status code" 80%
// case without making the user hand-edit YAML.
//
// Scope:
//   - method (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS dropdown)
//   - pathPattern (text input)
//   - defaultResponse.status (number)
//   - defaultResponse.body.type ('none' | 'json' | 'text' | 'xml')
//   - defaultResponse.body.content (textarea)
//
// Out of MVP scope (stays YAML-only): requestValidation, responseRules,
// multipliers, headers, form-data/binary bodies, delayMs. The editor reads
// these but doesn't render them — Save preserves them verbatim.
//
// Security model:
//   - Webview CSP locks scripts to a per-session nonce; no remote loads.
//   - `enableScripts: true` but `localResourceRoots: []` — nothing on the
//     filesystem is reachable from the webview.
//   - `vscode.WebviewMessage` traffic is unidirectional (host → webview = view
//     state; webview → host = save command + optional cancel).
//   - The host validates the saved payload against the same MockEndpoint
//     shape `applyMutation` accepts; rejection emits a toast and discards.
// =============================================================================

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const BODY_TYPES = ['none', 'json', 'text', 'xml'] as const;
type BodyType = (typeof BODY_TYPES)[number];

/**
 * Shape the host SENDS to the webview to seed the form. Mirrors the
 * subset of MockEndpoint the editor exposes; everything else stays in
 * the original endpoint object (`originalEndpoint` round-trips back on
 * save so we preserve fields the editor doesn't render).
 */
export interface MockEndpointFormState {
  endpointId: string;
  method: HttpMethod;
  pathPattern: string;
  status: number;
  bodyType: BodyType;
  bodyContent: string;
}

export interface SaveMessage {
  type: 'save';
  state: MockEndpointFormState;
}

export interface CancelMessage {
  type: 'cancel';
}

export type WebviewToHostMessage = SaveMessage | CancelMessage;

export interface EndpointEditorDeps {
  bridge: VsCodeBridge;
  /**
   * Called when the webview's Save button fires. The host wires this to a
   * patch that updates `synced.mockServers[mockId].endpoints[endpointId]`
   * via `applyMutation`. Errors surface as toasts; the webview stays open.
   */
  onSave: (state: MockEndpointFormState) => Promise<{ ok: boolean; error?: string }>;
  log?: (msg: string) => void;
}

/**
 * Open (or focus) the endpoint editor webview for a given endpoint. The
 * second + subsequent calls for the same endpointId reuse the existing
 * panel — multiple endpoints get their own panels.
 */
export class MockEndpointEditor implements vscode.Disposable {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: EndpointEditorDeps,
  ) {}

  open(initial: MockEndpointFormState, title: string): void {
    const existing = this.panels.get(initial.endpointId);
    if (existing) {
      existing.reveal(vscode.ViewColumn.Active);
      this.postSeed(existing, initial);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'apicircleMockEndpointEditor',
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        // No localResourceRoots — the page is self-contained inline HTML.
        // Anything else would expand the attack surface unnecessarily.
        localResourceRoots: [],
        retainContextWhenHidden: true,
      },
    );
    this.panels.set(initial.endpointId, panel);
    panel.onDidDispose(() => this.panels.delete(initial.endpointId));

    const nonce = crypto.randomBytes(16).toString('base64url');
    panel.webview.html = renderHtml(nonce);
    this.postSeed(panel, initial);

    panel.webview.onDidReceiveMessage(async (msg: unknown) => {
      const parsed = parseMessage(msg);
      if (!parsed) {
        this.deps.log?.(`endpoint editor received malformed message: ${JSON.stringify(msg)}`);
        return;
      }
      if (parsed.type === 'cancel') {
        panel.dispose();
        return;
      }
      // 'save'
      const result = await this.deps.onSave(parsed.state);
      if (result.ok) {
        await vscode.window.showInformationMessage('Mock endpoint saved.');
        panel.dispose();
      } else {
        await vscode.window.showErrorMessage(
          `Failed to save endpoint: ${result.error ?? 'unknown error'}`,
        );
      }
    });
  }

  private postSeed(panel: vscode.WebviewPanel, state: MockEndpointFormState): void {
    void panel.webview.postMessage({ type: 'seed', state });
  }

  dispose(): void {
    for (const panel of this.panels.values()) {
      try {
        panel.dispose();
      } catch {
        // ignore — VS Code may have already disposed it
      }
    }
    this.panels.clear();
  }
}

/**
 * Strict validation of an inbound message. Returns null when the payload
 * doesn't match the known shape — we err on the side of dropping anything
 * suspicious rather than parsing it leniently. Defence in depth: the
 * webview is sandboxed but we still validate every field.
 */
export function parseMessage(raw: unknown): WebviewToHostMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'cancel') return { type: 'cancel' };
  if (r.type !== 'save') return null;
  const state = r.state;
  if (!state || typeof state !== 'object') return null;
  const s = state as Record<string, unknown>;
  if (typeof s.endpointId !== 'string' || s.endpointId.length === 0) return null;
  if (!(HTTP_METHODS as readonly string[]).includes(s.method as string)) return null;
  if (typeof s.pathPattern !== 'string') return null;
  if (
    typeof s.status !== 'number' ||
    !Number.isInteger(s.status) ||
    s.status < 100 ||
    s.status > 599
  )
    return null;
  if (!(BODY_TYPES as readonly string[]).includes(s.bodyType as string)) return null;
  if (typeof s.bodyContent !== 'string') return null;
  return {
    type: 'save',
    state: {
      endpointId: s.endpointId,
      method: s.method as HttpMethod,
      pathPattern: s.pathPattern,
      status: s.status,
      bodyType: s.bodyType as BodyType,
      bodyContent: s.bodyContent,
    },
  };
}

// ---------------------------------------------------------------------------
// Webview HTML — self-contained, no external resources.
// ---------------------------------------------------------------------------

function renderHtml(nonce: string): string {
  // CSP: only scripts with our nonce; no inline event handlers; no remote.
  // Style-src 'unsafe-inline' is required for VS Code's CSS-variable theme;
  // it doesn't reduce CSS XSS risk meaningfully here (no untrusted CSS).
  const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}'`,
    `style-src 'unsafe-inline'`,
    `connect-src 'none'`,
    `img-src 'none'`,
    `font-src 'none'`,
  ].join('; ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Mock Endpoint Editor</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
  .row { display: flex; gap: 12px; margin-bottom: 12px; align-items: center; }
  .row label { flex: 0 0 120px; font-weight: 500; }
  .row input, .row select, .row textarea { flex: 1 1 auto; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 4px 6px; font-family: var(--vscode-font-family); }
  textarea { font-family: var(--vscode-editor-font-family); min-height: 200px; resize: vertical; }
  .actions { margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
  .json-invalid { border-color: var(--vscode-inputValidation-errorBorder) !important; }
</style>
</head>
<body>
<h2 id="title">Mock Endpoint Editor</h2>
<form id="form" autocomplete="off">
  <div class="row">
    <label for="method">Method</label>
    <select id="method" name="method">
      <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option>
      <option>DELETE</option><option>HEAD</option><option>OPTIONS</option>
    </select>
  </div>
  <div class="row">
    <label for="pathPattern">Path</label>
    <input id="pathPattern" name="pathPattern" type="text" placeholder="/users/{id}" />
  </div>
  <div class="row">
    <label for="status">Status</label>
    <input id="status" name="status" type="number" min="100" max="599" />
  </div>
  <div class="row">
    <label for="bodyType">Body type</label>
    <select id="bodyType" name="bodyType">
      <option>none</option><option>json</option><option>text</option><option>xml</option>
    </select>
  </div>
  <div class="row" style="align-items: flex-start;">
    <label for="bodyContent">Body</label>
    <textarea id="bodyContent" name="bodyContent" spellcheck="false"></textarea>
  </div>
  <p class="hint">Headers, response rules, request validation, and multipliers stay in the YAML — this editor only changes the fields above. Use the YAML editor for anything else.</p>
  <div class="actions">
    <button type="button" class="secondary" id="cancelBtn">Cancel</button>
    <button type="button" id="saveBtn">Save</button>
  </div>
</form>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let currentEndpointId = '';

  function applyState(state) {
    currentEndpointId = state.endpointId;
    document.getElementById('method').value = state.method;
    document.getElementById('pathPattern').value = state.pathPattern;
    document.getElementById('status').value = String(state.status);
    document.getElementById('bodyType').value = state.bodyType;
    document.getElementById('bodyContent').value = state.bodyContent;
    document.getElementById('title').textContent = state.method + ' ' + state.pathPattern;
    validateJson();
  }

  function readState() {
    return {
      endpointId: currentEndpointId,
      method: document.getElementById('method').value,
      pathPattern: document.getElementById('pathPattern').value,
      status: Number(document.getElementById('status').value),
      bodyType: document.getElementById('bodyType').value,
      bodyContent: document.getElementById('bodyContent').value,
    };
  }

  function validateJson() {
    const ta = document.getElementById('bodyContent');
    const t = document.getElementById('bodyType').value;
    if (t !== 'json' || ta.value.trim() === '') {
      ta.classList.remove('json-invalid');
      return true;
    }
    try {
      JSON.parse(ta.value);
      ta.classList.remove('json-invalid');
      return true;
    } catch {
      ta.classList.add('json-invalid');
      return false;
    }
  }

  document.getElementById('bodyType').addEventListener('change', validateJson);
  document.getElementById('bodyContent').addEventListener('input', validateJson);

  document.getElementById('saveBtn').addEventListener('click', () => {
    if (!validateJson()) {
      // Don't block; the host validator will catch + toast. Hint visible.
    }
    vscode.postMessage({ type: 'save', state: readState() });
  });
  document.getElementById('cancelBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'seed' && msg.state) {
      applyState(msg.state);
    }
  });
</script>
</body>
</html>`;
}
