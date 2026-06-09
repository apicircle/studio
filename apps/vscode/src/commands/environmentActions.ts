import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';

// =============================================================================
// Environment commands:
//   • setActiveEnvironment   — QuickPick of available envs, fires environment.setActive
//   • newEnvironment          — InputBox for name, scaffolds empty env, opens its YAML
//   • deleteEnvironment       — confirmation modal, fires environment.delete
//   • setEnvPriorityOrder     — multi-step QuickPick to reorder priorityOrder
// =============================================================================

export interface EnvironmentActionsDeps {
  bridge: VsCodeBridge;
}

interface EnvNode {
  kind: 'env';
  name: string;
}

export async function setActiveEnvironmentCommand(
  deps: EnvironmentActionsDeps,
  directName?: string,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const state = await active.read();
  const envs = Object.values(state.synced.environments.items);
  if (envs.length === 0) {
    await vscode.window.showInformationMessage(
      'No environments yet. Run "APICircle: New Environment" first.',
    );
    return;
  }

  // CodeLens path: caller passes the env name directly — skip the QuickPick.
  if (typeof directName === 'string') {
    if (!state.synced.environments.items[directName]) {
      await vscode.window.showWarningMessage(`Environment "${directName}" no longer exists.`);
      return;
    }
    await active.apply({ kind: 'environment.setActive', name: directName });
    return;
  }

  const items: Array<vscode.QuickPickItem & { name: string | null }> = [
    {
      label: '$(circle-slash) None',
      description: 'Unset the active environment',
      name: null,
    },
    ...envs
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({
        label: e.name,
        description:
          e.name === state.synced.environments.activeName
            ? '(currently active)'
            : `${e.variables.length} variable(s)`,
        name: e.name,
      })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Set active environment',
  });
  if (!picked) return;

  await active.apply({ kind: 'environment.setActive', name: picked.name });
}

export async function newEnvironmentCommand(deps: EnvironmentActionsDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const state = await active.read();
  const existing = new Set(Object.keys(state.synced.environments.items));

  const name = await vscode.window.showInputBox({
    prompt: 'Environment name',
    placeHolder: 'production',
    validateInput: (v) => {
      const trimmed = v.trim();
      if (trimmed.length === 0) return 'Name is required';
      if (existing.has(trimmed)) return `Environment "${trimmed}" already exists`;
      return null;
    },
  });
  if (name === undefined) return;

  const trimmed = name.trim();
  await active.apply({
    kind: 'environment.upsert',
    environment: { name: trimmed, variables: [] },
  });

  // Open the new env's YAML for immediate editing
  const uri = ApicircleFsProvider.environmentUri(active.workspace.id, trimmed);
  await vscode.commands.executeCommand('vscode.open', uri);
}

export async function deleteEnvironmentCommand(
  deps: EnvironmentActionsDeps,
  node?: EnvNode,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const name = node?.name ?? (await pickEnvName(deps, 'Delete environment'));
  if (!name) return;

  const state = await active.read();
  const env = state.synced.environments.items[name];
  if (!env) return;

  const confirm = await vscode.window.showWarningMessage(
    `Delete environment "${name}"? Its variables are removed from workspace.json. Reversible via Git.`,
    { modal: true },
    'Delete',
  );
  if (confirm !== 'Delete') return;

  await active.apply({ kind: 'environment.delete', name });
}

async function pickEnvName(
  deps: EnvironmentActionsDeps,
  placeHolder: string,
): Promise<string | null> {
  const active = deps.bridge.activeWorkspace();
  if (!active) return null;
  const state = await active.read();
  const envs = Object.values(state.synced.environments.items);
  if (envs.length === 0) {
    await vscode.window.showInformationMessage('No environments to operate on.');
    return null;
  }
  const picked = await vscode.window.showQuickPick(
    envs.map((e) => ({ label: e.name })),
    { placeHolder },
  );
  return picked?.label ?? null;
}
