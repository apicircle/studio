import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { WorkspaceView } from './WorkspaceView';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { WorkspaceSurface } from '../host/vscodeBridge';

function makeState(
  overrides: {
    requests?: Record<string, unknown>;
    folders?: Record<string, unknown>;
    environments?: Record<string, unknown>;
    mockServers?: Record<string, unknown>;
    executionPlans?: Record<string, unknown>;
  } = {},
) {
  return {
    synced: {
      collections: {
        requests: overrides.requests ?? { r1: {}, r2: {} },
        folders: overrides.folders ?? { f1: {} },
      },
      environments: overrides.environments ?? {
        items: { dev: {}, prod: {} },
        activeName: null,
        priorityOrder: [],
      },
      mockServers: overrides.mockServers ?? { m1: {} },
      executionPlans: overrides.executionPlans ?? { p1: {} },
    },
    local: {},
  };
}

function makeSurface(
  label = 'My API',
  source: 'git-folder' | 'registry' = 'git-folder',
): WorkspaceSurface {
  return {
    workspace: {
      id: 'ws-1',
      apicircleDir: '/repo/.apicircle/workspace-ws-1',
      workspaceJsonPath: '/repo/.apicircle/workspace-ws-1/workspace.json',
      workspaceFolder: undefined,
      label,
      source,
    },
    read: async () => makeState(),
    apply: async () => ({ next: makeState(), changedIds: [] }),
    write: async () => makeState(),
  } as unknown as WorkspaceSurface;
}

function makeBridge(surfaces: WorkspaceSurface[] = [], activeIdx = 0): VsCodeBridge {
  const activeId = surfaces.length > 0 ? surfaces[activeIdx].workspace.id : null;
  return {
    activeWorkspace: () =>
      activeId ? (surfaces.find((s) => s.workspace.id === activeId) ?? null) : null,
    listWorkspaces: () => surfaces,
  } as unknown as VsCodeBridge;
}

describe('WorkspaceView', () => {
  it('returns a single root node', async () => {
    const view = new WorkspaceView(makeBridge([makeSurface()]));
    const root = await view.getChildren();
    expect(root).toEqual([{ kind: 'active' }]);
  });

  it('returns empty children when no workspace is active', async () => {
    const view = new WorkspaceView(makeBridge([]));
    const root = await view.getChildren();
    expect(root).toEqual([{ kind: 'active' }]);
    const item = (await view.getTreeItem({ kind: 'active' })) as vscode.TreeItem;
    expect(item.label).toBe('No active workspace');
    expect(item.contextValue).toBe('workspace-empty');
  });

  it('renders active workspace with name and stats description', async () => {
    const view = new WorkspaceView(makeBridge([makeSurface('Pet Store')]));
    const item = (await view.getTreeItem({ kind: 'active' })) as vscode.TreeItem;
    expect(item.label).toBe('Pet Store');
    expect(item.contextValue).toBe('workspace-active');
    expect(typeof item.description).toBe('string');
    expect(item.description as string).toContain('2 requests');
    expect(item.description as string).toContain('1 folder');
    expect(item.description as string).toContain('2 envs');
    expect(item.description as string).toContain('1 mock');
  });

  it('omits mock count from description when zero', async () => {
    const surface = makeSurface();
    (surface as unknown as { read: () => Promise<unknown> }).read = async () =>
      makeState({ mockServers: {} });
    const view = new WorkspaceView(makeBridge([surface]));
    const item = (await view.getTreeItem({ kind: 'active' })) as vscode.TreeItem;
    expect(item.description as string).not.toContain('mock');
  });

  it('shows stat children for the active node', async () => {
    const view = new WorkspaceView(makeBridge([makeSurface()]));
    const children = await view.getChildren({ kind: 'active' });
    const labels = children.map((c) => ('label' in c ? c.label : c.kind));
    expect(labels).toContain('Source');
    expect(labels).toContain('Path');
    expect(labels).toContain('Requests');
    expect(labels).toContain('Folders');
    expect(labels).toContain('Environments');
    expect(labels).toContain('Mocks');
    expect(labels).toContain('Plans');
  });

  it('includes available-workspaces count when multiple exist', async () => {
    const s1 = makeSurface('WS 1');
    const s2: WorkspaceSurface = {
      ...makeSurface('WS 2'),
      workspace: { ...makeSurface('WS 2').workspace, id: 'ws-2' },
    } as unknown as WorkspaceSurface;
    const view = new WorkspaceView(makeBridge([s1, s2], 0));
    const children = await view.getChildren({ kind: 'active' });
    const availNode = children.find((c) => c.kind === 'stat' && c.label === 'Available workspaces');
    expect(availNode).toBeDefined();
    expect(availNode!.kind === 'stat' && availNode!.value).toBe('2');
  });

  it('does not show available-workspaces count when only one exists', async () => {
    const view = new WorkspaceView(makeBridge([makeSurface()]));
    const children = await view.getChildren({ kind: 'active' });
    const availNode = children.find((c) => c.kind === 'stat' && c.label === 'Available workspaces');
    expect(availNode).toBeUndefined();
  });

  it('renders stat nodes with label, value, and icon', async () => {
    const view = new WorkspaceView(makeBridge([makeSurface()]));
    const children = await view.getChildren({ kind: 'active' });
    const reqNode = children.find((c) => c.kind === 'stat' && c.label === 'Requests')!;
    const item = (await view.getTreeItem(reqNode)) as vscode.TreeItem;
    expect(item.label).toBe('Requests');
    expect(item.description).toBe('2');
    expect((item.iconPath as { id: string }).id).toBe('send');
  });

  it('returns no children for stat nodes', async () => {
    const view = new WorkspaceView(makeBridge([makeSurface()]));
    const children = await view.getChildren({
      kind: 'stat',
      label: 'Requests',
      value: '2',
      icon: 'send',
    });
    expect(children).toEqual([]);
  });

  it('shows registry source in tooltip for registry workspaces', async () => {
    const view = new WorkspaceView(makeBridge([makeSurface('Registry WS', 'registry')]));
    const item = (await view.getTreeItem({ kind: 'active' })) as vscode.TreeItem;
    expect(item.tooltip).toBeDefined();
    const md = item.tooltip as vscode.MarkdownString;
    expect(md.value).toContain('registry');
  });
});
