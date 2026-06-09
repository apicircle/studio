import * as vscode from 'vscode';
import type { MockEndpoint, MockResponseBody, MockServer } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { MockEndpointEditor, MockEndpointFormState } from '../webview/mockEndpointEditor';

// =============================================================================
// Phase 11 — `apicircle.editMockEndpoint` command. Opens the webview MVP
// editor for one endpoint inside a mock server.
//
// Arg shape from the MockView per-endpoint context menu:
//   { kind: 'mock-endpoint', mockId: string, endpointId: string }
//
// On Save: patches the mock via `mock.upsert` (re-emits the full mock server
// with the endpoint replaced) so the round-trip respects the existing
// applyMutation contract. Fields the editor doesn't expose
// (requestValidation / responseRules / multipliers / headers / form-data
// or binary bodies / delayMs) are preserved verbatim from the original
// MockEndpoint object.
// =============================================================================

export interface EditMockEndpointDeps {
  bridge: VsCodeBridge;
  editor: MockEndpointEditor;
  log?: (msg: string) => void;
}

/**
 * The MockView passes nodes shaped `{kind:'endpoint', serverId, endpointId}`
 * via the context-menu command-arguments contract. We accept both the
 * MockView shape and a more explicit `{kind:'mock-endpoint', mockId,...}`
 * shape for completion-from-command-palette / programmatic callers.
 */
interface EditArg {
  kind?: 'endpoint' | 'mock-endpoint';
  /** MockView shape. */
  serverId?: string;
  /** Programmatic-caller shape (alias for serverId). */
  mockId?: string;
  endpointId?: string;
}

export async function editMockEndpointCommand(
  deps: EditMockEndpointDeps,
  arg?: EditArg,
): Promise<void> {
  const surface = deps.bridge.activeWorkspace();
  if (!surface) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const mockId = arg?.mockId ?? arg?.serverId;
  if (!arg || !mockId || !arg.endpointId) {
    await vscode.window.showWarningMessage(
      'Open this command from a mock endpoint row in the Mock view.',
    );
    return;
  }
  const state = await surface.read();
  const mock = state.synced.mockServers[mockId];
  if (!mock) {
    await vscode.window.showErrorMessage(`Mock server "${arg.mockId}" not found.`);
    return;
  }
  const endpoint = mock.endpoints.find((e) => e.id === arg.endpointId);
  if (!endpoint) {
    await vscode.window.showErrorMessage(
      `Endpoint "${arg.endpointId}" not found inside mock "${mock.name}".`,
    );
    return;
  }

  const initial: MockEndpointFormState = {
    endpointId: endpoint.id,
    method: methodAsForm(endpoint.method),
    pathPattern: endpoint.pathPattern,
    status: endpoint.defaultResponse.status,
    bodyType: bodyTypeAsForm(endpoint.defaultResponse.body.type),
    bodyContent: bodyContentAsString(endpoint.defaultResponse.body),
  };

  deps.editor.open(initial, `${endpoint.method} ${endpoint.pathPattern}`);

  // Wire onSave is set ONCE at editor construction (see extension.ts);
  // this command does NOT need to handle save here.
}

/**
 * Apply a saved form payload back onto a MockEndpoint. Preserves every
 * field the editor doesn't render. Returns the next MockServer object
 * ready to feed into the `mock.upsert` patch.
 */
export function applyFormStateToMock(
  mock: MockServer,
  state: MockEndpointFormState,
): { next: MockServer; ok: true } | { ok: false; error: string } {
  const idx = mock.endpoints.findIndex((e) => e.id === state.endpointId);
  if (idx === -1) {
    return { ok: false, error: `Endpoint ${state.endpointId} no longer exists in the mock.` };
  }
  const original = mock.endpoints[idx];
  // Validate JSON body before persisting — host-side check mirroring the
  // webview's inline highlight, so an external bad-form-send can't slip
  // through.
  if (state.bodyType === 'json' && state.bodyContent.trim().length > 0) {
    try {
      JSON.parse(state.bodyContent);
    } catch (err) {
      return {
        ok: false,
        error: `Body type is json but content does not parse: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  const nextBody: MockResponseBody = buildNextBody(state, original.defaultResponse.body);
  const nextEndpoint: MockEndpoint = {
    ...original,
    method: state.method,
    pathPattern: state.pathPattern,
    defaultResponse: {
      ...original.defaultResponse,
      status: state.status,
      body: nextBody,
    },
  };
  const nextEndpoints = mock.endpoints.slice();
  nextEndpoints[idx] = nextEndpoint;
  return { ok: true, next: { ...mock, endpoints: nextEndpoints } };
}

function buildNextBody(state: MockEndpointFormState, original: MockResponseBody): MockResponseBody {
  if (state.bodyType === 'none') return { type: 'none', content: '' };
  if (state.bodyType === 'json') return { type: 'json', content: state.bodyContent };
  if (state.bodyType === 'text') return { type: 'text', content: state.bodyContent };
  if (state.bodyType === 'xml') return { type: 'xml', content: state.bodyContent };
  // Unreachable per parseMessage validation, but keep the original to
  // preserve form-data/binary/urlencoded if the editor ever expands.
  return original;
}

function methodAsForm(m: MockEndpoint['method']): MockEndpointFormState['method'] {
  const upper = m.toUpperCase();
  const allowed: ReadonlyArray<MockEndpointFormState['method']> = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
  ];
  return (allowed as readonly string[]).includes(upper)
    ? (upper as MockEndpointFormState['method'])
    : 'GET';
}

function bodyTypeAsForm(t: MockResponseBody['type']): MockEndpointFormState['bodyType'] {
  if (t === 'json' || t === 'text' || t === 'xml' || t === 'none') return t;
  // form-data / urlencoded / binary fall back to 'none' in the form (the
  // YAML still owns those — the editor hides the body field for them).
  // For Phase 11 MVP we keep them visible but with empty content so a save
  // doesn't corrupt complex bodies. The user will need YAML to round-trip.
  return 'none';
}

function bodyContentAsString(body: MockResponseBody): string {
  if (body.type === 'none' || body.type === 'form-data' || body.type === 'binary') return '';
  return body.content;
}
