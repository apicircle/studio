import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import { generateId } from '@apicircle/shared';
import type { MockServer, MockServerSource } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { VsCodeMockController } from '../host/vscodeMockController';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';

// F-G3: dynamic-import @apicircle/mock-server-core so the 1.3 MB of
// OpenAPI / Postman / Insomnia parsers only land in memory when the
// New Mock wizard actually runs. Trimmed cold-start activation bundle
// by ~1 MB (verified via tsup build).
//
// F-G5: size threshold above which we warn before reading a spec file.
// 10 MB covers realistic enterprise OpenAPI specs; anything larger is
// almost certainly a mistake (binary, wrong file, etc.).
const SPEC_SIZE_WARN_BYTES = 10 * 1024 * 1024;

// =============================================================================
// Mock server lifecycle commands.
//
// All commands operate on the active workspace's `synced.mockServers`.
// Runtime state (port, pid, requestCount) is owned by VsCodeMockController
// and lives in `local.mockRuntime.active`.
// =============================================================================

export interface MockActionsDeps {
  bridge: VsCodeBridge;
  controller: VsCodeMockController;
}

/**
 * `APICircle: New Mock` — wizard:
 *   1. Pick source (OpenAPI URL/file / Postman collection / Insomnia export / Manual)
 *   2. Provide the source content
 *   3. Name (auto-suggested from spec title)
 *   4. Default port (number or blank = pick free port)
 *
 * Creates the MockServer via `mock.upsert` and opens its `.mock.yaml`.
 */
export async function newMockCommand(deps: MockActionsDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }

  // Step 1: source kind
  const sourceKindPick = await vscode.window.showQuickPick(
    [
      { label: '$(file-code) OpenAPI spec (paste JSON or YAML)', value: 'openapi' as const },
      { label: '$(briefcase) Postman collection (paste JSON)', value: 'postman' as const },
      { label: '$(globe) Insomnia export (paste JSON)', value: 'insomnia' as const },
      { label: '$(edit) Manual — empty endpoint list', value: 'manual' as const },
    ],
    { placeHolder: 'Source (step 1 of 4)' },
  );
  if (!sourceKindPick) return;

  // Step 2: source content (skipped for manual).
  //
  // P3R5-G4: the previous single-line `showInputBox` choked on real specs
  // (multi-line YAML / kilobytes of JSON). Step 2 is now a two-stage prompt:
  // first pick paste-vs-file, then collect content via the right surface.
  let source: MockServerSource;
  if (sourceKindPick.value === 'manual') {
    source = { kind: 'manual', endpoints: [] };
  } else {
    const sourceLabel =
      sourceKindPick.value === 'openapi'
        ? 'OpenAPI'
        : sourceKindPick.value === 'postman'
          ? 'Postman'
          : 'Insomnia';
    const methodPick = await vscode.window.showQuickPick(
      [
        { label: '$(file) Read from file…', value: 'file' as const },
        { label: '$(cloud) Fetch from URL…', value: 'url' as const },
        {
          label: '$(edit) Paste content (single-line — small specs only)',
          value: 'paste' as const,
        },
      ],
      { placeHolder: `How do you want to supply the ${sourceLabel} content? (step 2 of 5)` },
    );
    if (!methodPick) return;

    let content: string;
    if (methodPick.value === 'file') {
      const fileFilters: Record<string, string[]> =
        sourceKindPick.value === 'openapi'
          ? { OpenAPI: ['yaml', 'yml', 'json'], 'All Files': ['*'] }
          : { JSON: ['json'], 'All Files': ['*'] };
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: `Pick ${sourceLabel} file`,
        filters: fileFilters,
      });
      if (!picked || picked.length === 0) return;
      // F-G5: size-check before loading into memory. Real enterprise
      // OpenAPI specs cap around 5-8 MB; anything larger usually means
      // the user picked the wrong file.
      try {
        const stat = await fs.stat(picked[0].fsPath);
        if (stat.size > SPEC_SIZE_WARN_BYTES) {
          const mb = (stat.size / (1024 * 1024)).toFixed(1);
          const proceed = await vscode.window.showWarningMessage(
            `${picked[0].fsPath} is ${mb} MB. Loading large specs blocks the extension host briefly. Continue?`,
            { modal: true },
            'Continue',
          );
          if (proceed !== 'Continue') return;
        }
        content = await fs.readFile(picked[0].fsPath, 'utf-8');
      } catch (e) {
        await vscode.window.showErrorMessage(
          `Failed to read ${picked[0].fsPath}: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
    } else if (methodPick.value === 'url') {
      // F-G6: fetch spec from HTTP(S) URL — common pattern is
      // https://petstore.swagger.io/v2/swagger.json.
      const url = await vscode.window.showInputBox({
        prompt: `URL to fetch ${sourceLabel} content from (step 3 of 5)`,
        placeHolder: 'https://petstore.swagger.io/v2/swagger.json',
        validateInput: (v) => {
          const t = v.trim();
          if (t.length === 0) return 'URL is required';
          if (!/^https?:\/\//.test(t)) return 'URL must start with http:// or https://';
          return null;
        },
      });
      if (url === undefined) return;
      try {
        const resp = await fetch(url.trim());
        if (!resp.ok) {
          await vscode.window.showErrorMessage(
            `Fetch failed (${resp.status} ${resp.statusText}): ${url}`,
          );
          return;
        }
        content = await resp.text();
      } catch (e) {
        await vscode.window.showErrorMessage(
          `Failed to fetch ${url}: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
    } else {
      const pasted = await vscode.window.showInputBox({
        prompt: `Paste ${sourceLabel} content (step 3 of 5)`,
        placeHolder: sourceKindPick.value === 'openapi' ? 'openapi: 3.0.0\\ninfo: …' : '{ ... }',
        validateInput: (v) => (v.trim().length === 0 ? 'Source content is required' : null),
      });
      if (pasted === undefined) return;
      content = pasted;
    }

    if (sourceKindPick.value === 'openapi') {
      const format = content.trimStart().startsWith('{') ? 'json' : 'yaml';
      source = { kind: 'openapi', spec: content, format };
    } else if (sourceKindPick.value === 'postman') {
      source = { kind: 'postman', collection: content };
    } else {
      source = { kind: 'insomnia', export: content };
    }
  }

  // Step 4: name (step 3 for manual). F-G7: pre-fill from spec metadata
  // when we can extract it cheaply. Looks for `info.title` (OpenAPI) /
  // `info.name` (Postman) / `_type: export.name` (Insomnia). Best-effort
  // — silent fallback to blank on parse error.
  const suggestedName = suggestNameFromSource(source);
  const name = await vscode.window.showInputBox({
    prompt: `Mock name (step ${source.kind === 'manual' ? '2 of 3' : '4 of 5'})`,
    placeHolder: 'Pet Store mock',
    value: source.kind === 'manual' ? 'Manual mock' : suggestedName,
    validateInput: (v) => (v.trim().length === 0 ? 'Name is required' : null),
  });
  if (name === undefined) return;

  // Step 5: default port (step 3 for manual)
  const portInput = await vscode.window.showInputBox({
    prompt: `Default port — leave blank to pick a free port (step ${source.kind === 'manual' ? '3 of 3' : '5 of 5'})`,
    placeHolder: '3000',
    validateInput: (v) => {
      if (v.trim().length === 0) return null;
      const n = Number(v);
      if (!Number.isInteger(n)) return 'Enter an integer port number or leave blank';
      if (n < 1024 || n > 65535) return 'Port must be 1024-65535';
      return null;
    },
  });
  if (portInput === undefined) return;
  const defaultPort = portInput.trim().length === 0 ? null : Number(portInput);

  // Parse endpoints up-front so a bad spec fails the wizard instead of failing
  // silently when the user clicks Start later.
  //
  // F-G3: dynamic-import the parsers — they pull in ~1 MB of dependencies
  // and are only needed here in the wizard.
  let endpoints: MockServer['endpoints'] = [];
  if (source.kind !== 'manual') {
    try {
      const { parseSourceToEndpoints } = await import('@apicircle/mock-server-core');
      const parsed = await parseSourceToEndpoints(source);
      endpoints = parsed.endpoints;
      if (parsed.warnings.length > 0) {
        // P3R1-G5: surface the full warning count + first message so the
        // user knows others exist. Full list goes to the consolidated
        // `APICircle Runs` OutputChannel (Phase 4 wired this — but mock
        // parsing happens before the controller hands us a logger, so the
        // stopgap console.warn below is fine; it lands in the Extension
        // Host log either way).
        const more = parsed.warnings.length > 1 ? ` (+${parsed.warnings.length - 1} more)` : '';
        await vscode.window.showWarningMessage(
          `Parsed with ${parsed.warnings.length} warning(s): ${parsed.warnings[0]}${more}`,
        );
        for (const w of parsed.warnings) {
          console.warn('[apicircle.newMock]', w);
        }
      }
    } catch (e) {
      await vscode.window.showErrorMessage(
        `Failed to parse ${source.kind} source: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
  }

  const now = new Date().toISOString();
  const mock: MockServer = {
    id: generateId(),
    name,
    source,
    endpoints,
    defaultPort,
    cors: { enabled: false, origins: [] },
    createdAt: now,
    updatedAt: now,
  };
  await active.apply({ kind: 'mock.upsert', mock });
  const uri = ApicircleFsProvider.mockUri(active.workspace.id, mock);
  await vscode.commands.executeCommand('vscode.open', uri);
  await vscode.window.showInformationMessage(
    `Created mock "${name}" with ${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'}.`,
  );
}

export async function startMockCommand(
  deps: MockActionsDeps,
  node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string },
): Promise<void> {
  const id = await resolveMockId(deps, node, 'start');
  if (!id) return;
  const active = deps.bridge.activeWorkspace();
  if (!active) return;
  const state = await active.read();
  const mock = state.synced.mockServers[id];
  if (!mock) {
    await vscode.window.showWarningMessage('Mock no longer exists.');
    return;
  }
  if (await deps.controller.isRunning(id)) {
    const rt = await deps.controller.runtime(id);
    await vscode.window.showInformationMessage(
      `Mock "${mock.name}" already running on port ${rt?.port ?? '?'}.`,
    );
    return;
  }
  try {
    const result = await deps.controller.start(mock);
    await vscode.window.showInformationMessage(
      `Started "${mock.name}" on http://localhost:${result.port}`,
    );
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Failed to start mock: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function stopMockCommand(
  deps: MockActionsDeps,
  node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string },
): Promise<void> {
  const id = await resolveMockId(deps, node, 'stop');
  if (!id) return;
  if (!(await deps.controller.isRunning(id))) {
    await vscode.window.showInformationMessage('Mock is not running.');
    return;
  }
  try {
    await deps.controller.stop(id);
    await vscode.window.showInformationMessage('Mock stopped.');
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Failed to stop mock: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function restartMockCommand(
  deps: MockActionsDeps,
  node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string },
): Promise<void> {
  const id = await resolveMockId(deps, node, 'restart');
  if (!id) return;
  const active = deps.bridge.activeWorkspace();
  if (!active) return;
  const state = await active.read();
  const mock = state.synced.mockServers[id];
  if (!mock) {
    await vscode.window.showWarningMessage('Mock no longer exists.');
    return;
  }
  try {
    const result = await deps.controller.restart(mock);
    await vscode.window.showInformationMessage(
      `Restarted "${mock.name}" on http://localhost:${result.port}`,
    );
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Failed to restart mock: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function deleteMockCommand(
  deps: MockActionsDeps,
  node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string },
): Promise<void> {
  const id = await resolveMockId(deps, node, 'delete');
  if (!id) return;
  const active = deps.bridge.activeWorkspace();
  if (!active) return;
  const state = await active.read();
  const mock = state.synced.mockServers[id];
  if (!mock) {
    await vscode.window.showWarningMessage('Mock no longer exists.');
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Delete mock "${mock.name}"? Its source + endpoint definitions are removed from workspace.json. Stop it first if running.`,
    { modal: true },
    'Delete',
  );
  if (confirm !== 'Delete') return;
  // Auto-stop if running.
  if (await deps.controller.isRunning(id)) {
    await deps.controller.stop(id);
  }
  await active.apply({ kind: 'mock.delete', id });
}

/**
 * F-G13: open the running mock's URL in the system browser. Wired to the
 * `mock-running` viewItem context menu so the user doesn't have to copy
 * the port out of the tree label or status bar.
 */
export async function openMockInBrowserCommand(
  deps: MockActionsDeps,
  node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string },
): Promise<void> {
  const id = await resolveMockId(deps, node, 'open');
  if (!id) return;
  if (!(await deps.controller.isRunning(id))) {
    await vscode.window.showInformationMessage('Start the mock first to open it in a browser.');
    return;
  }
  const rt = await deps.controller.runtime(id);
  if (!rt) return;
  await vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${rt.port}`));
}

/**
 * `apicircle.setMockPort` — one-click way to change a mock's default port
 * without opening its `.mock.yaml`. Same validation surface as the YAML
 * parser (1024-65535 integer or blank = `null` for "pick a free port").
 *
 * If the mock is currently running, we warn that the new port only takes
 * effect on next Start — the runtime is the authority on hot port changes
 * and we don't model a transparent stop/restart here (the user may have
 * in-flight clients).
 *
 * Errors at start-time (port busy, port invalid, permission denied) are
 * surfaced by `startMockCommand` via the MockServerStartError thrown from
 * `@apicircle/mock-server-core` — this command only persists the
 * definition; it does not attempt to bind the port itself.
 */
export async function setMockPortCommand(
  deps: MockActionsDeps,
  node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string },
): Promise<void> {
  const id = await resolveMockId(deps, node, 'set port for');
  if (!id) return;
  const active = deps.bridge.activeWorkspace();
  if (!active) return;
  const state = await active.read();
  const mock = state.synced.mockServers[id];
  if (!mock) {
    await vscode.window.showWarningMessage('Mock no longer exists.');
    return;
  }
  const running = await deps.controller.isRunning(id);
  const portInput = await vscode.window.showInputBox({
    prompt: running
      ? `New default port for "${mock.name}" — leave blank for auto. Takes effect on next Start (mock is currently running).`
      : `Default port for "${mock.name}" — leave blank to pick a free port`,
    placeHolder: '3000',
    value: mock.defaultPort === null ? '' : String(mock.defaultPort),
    validateInput: (v) => {
      if (v.trim().length === 0) return null;
      const n = Number(v);
      if (!Number.isInteger(n)) return 'Enter an integer port number or leave blank';
      if (n < 1024 || n > 65535) return 'Port must be 1024-65535';
      return null;
    },
  });
  if (portInput === undefined) return;
  const trimmed = portInput.trim();
  const nextPort = trimmed.length === 0 ? null : Number(trimmed);
  if (nextPort === mock.defaultPort) return;
  const updated: MockServer = {
    ...mock,
    defaultPort: nextPort,
    updatedAt: new Date().toISOString(),
  };
  await active.apply({ kind: 'mock.upsert', mock: updated });
  await vscode.window.showInformationMessage(
    nextPort === null
      ? `"${mock.name}" will pick a free port at next Start.`
      : `"${mock.name}" default port set to ${nextPort}.`,
  );
}

/**
 * F-G7: best-effort name suggestion. Tries to read the spec's title /
 * collection name before the parser runs. Returns '' on any failure
 * — never throws (the wizard still works without a suggestion).
 */
function suggestNameFromSource(source: MockServerSource): string {
  try {
    if (source.kind === 'openapi') {
      if (source.format === 'json') {
        const parsed = JSON.parse(source.spec) as { info?: { title?: string } };
        if (typeof parsed.info?.title === 'string' && parsed.info.title.length > 0) {
          return parsed.info.title;
        }
      } else {
        // YAML — cheap regex peek for `title:` in the first 50 lines.
        const head = source.spec.split('\n', 50).join('\n');
        const m = /^\s*title:\s*['"]?(.+?)['"]?\s*$/m.exec(head);
        if (m) return m[1].trim();
      }
    } else if (source.kind === 'postman') {
      const parsed = JSON.parse(source.collection) as { info?: { name?: string } };
      if (typeof parsed.info?.name === 'string' && parsed.info.name.length > 0) {
        return parsed.info.name;
      }
    } else if (source.kind === 'insomnia') {
      const parsed = JSON.parse(source.export) as {
        resources?: Array<{ _type?: string; name?: string }>;
      };
      const workspaceRow = parsed.resources?.find((r) => r._type === 'workspace');
      if (workspaceRow?.name) return workspaceRow.name;
    }
  } catch {
    // ignore — best-effort
  }
  return '';
}

/**
 * P3R1-G4: per-endpoint context-menu actions for `mock-endpoint` items.
 *
 * Copy Path Pattern → places `pathPattern` on the system clipboard.
 * Reveal in Mock YAML → opens the parent server's mock YAML and reveals
 *   the endpoint's pathPattern line.
 */
export async function copyEndpointPathCommand(
  deps: MockActionsDeps,
  node?: { kind: 'endpoint'; serverId: string; endpointId: string },
): Promise<void> {
  if (!node || node.kind !== 'endpoint') {
    await vscode.window.showWarningMessage(
      'Right-click an endpoint in the Mock view to copy its path.',
    );
    return;
  }
  const active = deps.bridge.activeWorkspace();
  if (!active) return;
  const state = await active.read();
  const server = state.synced.mockServers[node.serverId];
  const ep = server?.endpoints.find((e) => e.id === node.endpointId);
  if (!ep) {
    await vscode.window.showWarningMessage('Endpoint no longer exists.');
    return;
  }
  await vscode.env.clipboard.writeText(ep.pathPattern);
  await vscode.window.showInformationMessage(`Copied: ${ep.pathPattern}`);
}

/**
 * `apicircle.openMockEndpointYaml` — opens the per-endpoint YAML for a tree
 * node. Wired to the inline pencil + the click action on a mock endpoint row.
 * The legacy `editMockEndpoint` (webview form) is still reachable via the
 * right-click context menu for users who prefer the GUI form.
 */
export async function openMockEndpointYamlCommand(
  deps: MockActionsDeps,
  node?: { kind: 'endpoint'; serverId: string; endpointId: string },
): Promise<void> {
  if (!node || node.kind !== 'endpoint') {
    await vscode.window.showWarningMessage(
      'Right-click an endpoint in the Mock view to open its YAML.',
    );
    return;
  }
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const stateBeforeOpen = await active.read();
  const serverBeforeOpen = stateBeforeOpen.synced.mockServers[node.serverId];
  if (!serverBeforeOpen) {
    await vscode.window.showWarningMessage('Mock no longer exists.');
    return;
  }
  const epBeforeOpen = serverBeforeOpen.endpoints.find((e) => e.id === node.endpointId);
  if (!epBeforeOpen) {
    await vscode.window.showWarningMessage('Endpoint no longer exists.');
    return;
  }
  const uri = ApicircleFsProvider.endpointUri(active.workspace.id, serverBeforeOpen, epBeforeOpen);
  await vscode.commands.executeCommand('vscode.open', uri);
}

export async function revealEndpointInMockYamlCommand(
  deps: MockActionsDeps,
  node?: { kind: 'endpoint'; serverId: string; endpointId: string },
): Promise<void> {
  if (!node || node.kind !== 'endpoint') {
    await vscode.window.showWarningMessage(
      'Right-click an endpoint in the Mock view to reveal it.',
    );
    return;
  }
  const active = deps.bridge.activeWorkspace();
  if (!active) return;
  const state = await active.read();
  const server = state.synced.mockServers[node.serverId];
  if (!server) {
    await vscode.window.showWarningMessage('Mock no longer exists.');
    return;
  }
  const ep = server.endpoints.find((e) => e.id === node.endpointId);
  if (!ep) {
    await vscode.window.showWarningMessage('Endpoint no longer exists.');
    return;
  }
  const uri = ApicircleFsProvider.mockUri(active.workspace.id, server);
  const doc = await vscode.workspace.openTextDocument(uri);
  // Find the line whose text contains "id: <endpointId>" — robust against
  // ordering and indentation changes.
  let revealLine = 0;
  for (let i = 0; i < doc.lineCount; i++) {
    if (doc.lineAt(i).text.includes(`id: ${ep.id}`)) {
      revealLine = i;
      break;
    }
  }
  const editor = await vscode.window.showTextDocument(doc);
  const range = new vscode.Range(revealLine, 0, revealLine, 0);
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

/**
 * Resolve a mock id either from the tree-node argument or via a QuickPick
 * over the workspace's mocks. Returns undefined when the picker is cancelled
 * or the workspace has no mocks.
 */
async function resolveMockId(
  deps: MockActionsDeps,
  node: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string } | undefined,
  verb: string,
): Promise<string | undefined> {
  if (
    node &&
    (node.kind === 'server' || node.kind === 'mock-running' || node.kind === 'mock-idle')
  ) {
    return node.id;
  }
  const active = deps.bridge.activeWorkspace();
  if (!active) return undefined;
  const state = await active.read();
  const mocks = Object.values(state.synced.mockServers);
  if (mocks.length === 0) {
    await vscode.window.showInformationMessage('No mock servers to ' + verb + '.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    mocks.map((m) => ({ label: m.name, description: m.endpoints.length + ' endpoints', id: m.id })),
    { placeHolder: 'Pick a mock to ' + verb },
  );
  return picked?.id;
}
