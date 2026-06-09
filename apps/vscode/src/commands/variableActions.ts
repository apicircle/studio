import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// Per-variable edit/delete actions on environment variable rows (gap #19).
//
// Triggered from the EnvironmentView's right-click menu where viewItem is
// `variable` or `variable-encrypted`. Edits the variable's value (or rotates
// the secret slot for encrypted) and persists via environment.upsert.
// =============================================================================

export interface VariableActionsDeps {
  bridge: VsCodeBridge;
}

interface VariableNode {
  kind: 'variable';
  envName: string;
  key: string;
}

export async function editVariableValueCommand(
  deps: VariableActionsDeps,
  node?: VariableNode,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active || !node) return;
  const state = await active.read();
  const env = state.synced.environments.items[node.envName];
  if (!env) return;
  const variable = env.variables.find((v) => v.key === node.key);
  if (!variable) return;

  if (variable.encrypted) {
    // Phase 4: encrypted variables route to the vault entry flow which
    // unlocks (if needed), decrypts, and offers Copy / Show actions.
    await vscode.commands.executeCommand('apicircle.openVaultEntry', node);
    return;
  }

  const newValue = await vscode.window.showInputBox({
    prompt: `New value for ${node.key} in ${node.envName}`,
    value: variable.value,
  });
  if (newValue === undefined) return;

  const updated = {
    ...env,
    variables: env.variables.map((v) => (v.key === node.key ? { ...v, value: newValue } : v)),
  };
  await active.apply({ kind: 'environment.upsert', environment: updated });
}

export async function deleteVariableCommand(
  deps: VariableActionsDeps,
  node?: VariableNode,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active || !node) return;
  const state = await active.read();
  const env = state.synced.environments.items[node.envName];
  if (!env) return;
  const confirm = await vscode.window.showWarningMessage(
    `Delete variable "${node.key}" from "${node.envName}"?`,
    { modal: true },
    'Delete',
  );
  if (confirm !== 'Delete') return;
  const updated = {
    ...env,
    variables: env.variables.filter((v) => v.key !== node.key),
  };
  await active.apply({ kind: 'environment.upsert', environment: updated });
}
