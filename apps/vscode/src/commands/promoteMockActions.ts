import * as vscode from 'vscode';
import { buildMockPromotion } from '@apicircle/core';
import type { MockActionsDeps } from './mockActions';

// Mock → collection promotion for the VS Code extension. Reuses the shared
// `buildMockPromotion` (@apicircle/core) so the extension produces the exact
// same "Mock" env + "<name> (mock)" folder + templated requests as the
// web/desktop app and the MCP server. Applied through the canonical
// `active.apply(patch)` cycle, one WorkspacePatch at a time.

/** `API Circle: Add all to collection` — every endpoint of a mock at once. */
export async function addAllToCollectionCommand(
  deps: MockActionsDeps,
  node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string },
): Promise<void> {
  if (!node?.id) {
    await vscode.window.showWarningMessage(
      'Run "Add all to collection" from a mock in the Mocks view.',
    );
    return;
  }
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  const state = await active.read();
  const mock = state.synced.mockServers[node.id];
  if (!mock) {
    await vscode.window.showWarningMessage('Mock no longer exists.');
    return;
  }
  const { patches, requestIds } = buildMockPromotion(state.synced, mock, mock.endpoints);
  for (const patch of patches) await active.apply(patch);
  await vscode.window.showInformationMessage(
    `Added ${requestIds.length} request${requestIds.length === 1 ? '' : 's'} from "${mock.name}" ` +
      `into a "${mock.name} (mock)" folder (see the Mock environment for the base URL + port).`,
  );
}

/** `API Circle: Add to collection` — a single endpoint (endpoint tree node). */
export async function addEndpointToCollectionCommand(
  deps: MockActionsDeps,
  node?: { kind: 'endpoint'; serverId: string; endpointId: string },
): Promise<void> {
  if (!node || node.kind !== 'endpoint') {
    await vscode.window.showWarningMessage('Run "Add to collection" from a mock endpoint.');
    return;
  }
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  const state = await active.read();
  const mock = state.synced.mockServers[node.serverId];
  const ep = mock?.endpoints.find((e) => e.id === node.endpointId);
  if (!mock || !ep) {
    await vscode.window.showWarningMessage('Mock endpoint no longer exists.');
    return;
  }
  const { patches } = buildMockPromotion(state.synced, mock, [ep]);
  for (const patch of patches) await active.apply(patch);
  await vscode.window.showInformationMessage(
    `Added "${ep.name || `${ep.method} ${ep.pathPattern}`}" into a "${mock.name} (mock)" folder.`,
  );
}
