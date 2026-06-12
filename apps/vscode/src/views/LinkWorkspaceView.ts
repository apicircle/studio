import * as vscode from 'vscode';
import { sortVersionsDesc } from '@apicircle/core';
import { BaseTreeView } from './BaseTreeView';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// Link Workspaces view.
//
// Home for this workspace's place in the link/publish ecosystem. Phase 1 wires
// the publishing side — the **Releases** group lists the versions linked
// consumers pin to, with the publish / deprecate / withdraw lifecycle driven
// from here + the read-only `releases.yaml` CodeLens actions.
//
// The consuming side (linking to other workspaces, marketplace discovery) is a
// later phase; the view's empty/welcome copy points at that.
// =============================================================================

export type LinkWorkspaceNode =
  | { kind: 'releasesRoot' }
  | { kind: 'release'; version: string; deprecated: boolean; yanked: boolean }
  | { kind: 'linkedRoot' }
  | { kind: 'linkedWorkspace'; id: string }
  | { kind: 'linkedRequest'; linkId: string; requestId: string };

export class LinkWorkspaceView extends BaseTreeView<LinkWorkspaceNode> {
  readonly viewId = 'apicircle.linkWorkspaces';

  constructor(private readonly bridge: VsCodeBridge) {
    super();
  }

  async getChildren(element?: LinkWorkspaceNode): Promise<LinkWorkspaceNode[]> {
    const active = this.bridge.activeWorkspace();
    if (!active) return [];
    if (!element) {
      return [{ kind: 'releasesRoot' }, { kind: 'linkedRoot' }];
    }
    if (element.kind === 'releasesRoot') {
      const state = await active.read();
      const ledger = state.synced.releases.self;
      if (!ledger || ledger.versions.length === 0) return [];
      const order = sortVersionsDesc(ledger.versions.map((v) => v.version));
      const byVersion = new Map(ledger.versions.map((v) => [v.version, v]));
      return order
        .map((v) => byVersion.get(v))
        .filter((v): v is NonNullable<typeof v> => v !== undefined)
        .map((v) => ({
          kind: 'release' as const,
          version: v.version,
          deprecated: v.deprecated,
          yanked: v.yanked,
        }));
    }
    if (element.kind === 'linkedRoot') {
      const state = await active.read();
      return Object.values(state.synced.linkedWorkspaces)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((l) => ({ kind: 'linkedWorkspace' as const, id: l.id }));
    }
    if (element.kind === 'linkedWorkspace') {
      const state = await active.read();
      const snapshot = state.local.linkedCollections[element.id];
      if (!snapshot) return [];
      // Only the requests the link's scope includes collections for.
      const link = state.synced.linkedWorkspaces[element.id];
      if (link && !link.scope.includes('collections')) return [];
      return Object.values(snapshot.collections.requests)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => ({ kind: 'linkedRequest' as const, linkId: element.id, requestId: r.id }));
    }
    return [];
  }

  async getTreeItem(node: LinkWorkspaceNode): Promise<vscode.TreeItem> {
    if (node.kind === 'releasesRoot') {
      const item = new vscode.TreeItem('Releases', vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('package');
      item.contextValue = 'apicircleReleasesRoot';
      item.tooltip = "This workspace's published releases — the versions linked consumers pin to.";
      item.description = await this.releasesSummary();
      item.command = {
        command: 'apicircle.openReleaseHistory',
        title: 'Open release history',
      };
      return item;
    }
    if (node.kind === 'linkedRoot') {
      const item = new vscode.TreeItem(
        'Linked workspaces',
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon('link');
      item.contextValue = 'apicircleLinkedRoot';
      item.tooltip = 'Workspaces this one consumes, one level deep.';
      item.description = await this.linkedSummary();
      return item;
    }
    if (node.kind === 'linkedWorkspace') {
      const active = this.bridge.activeWorkspace();
      const state = active ? await active.read() : undefined;
      const link = state?.synced.linkedWorkspaces[node.id];
      if (!link) return new vscode.TreeItem('(unlinked)');
      // Collapsible only when there are cached requests to browse.
      const hasRequests =
        link.scope.includes('collections') &&
        Object.keys(state?.local.linkedCollections[node.id]?.collections.requests ?? {}).length > 0;
      const item = new vscode.TreeItem(
        link.name,
        hasRequests
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );
      const pin = link.pinnedVersion ? `v${link.pinnedVersion}` : 'unpinned';
      item.description = `${link.kind} · ${pin}`;
      item.iconPath = new vscode.ThemeIcon('repo');
      item.tooltip = `${link.source.repoFullName}@${link.source.branch}`;
      item.contextValue = 'apicircleLinkedWorkspace';
      item.command = {
        command: 'apicircle.openLinkYaml',
        title: 'Open linked workspace',
        arguments: [{ id: link.id }],
      };
      return item;
    }
    if (node.kind === 'linkedRequest') {
      const active = this.bridge.activeWorkspace();
      const state = active ? await active.read() : undefined;
      const req = state?.local.linkedCollections[node.linkId]?.collections.requests[node.requestId];
      if (!req) return new vscode.TreeItem('(missing request)');
      const item = new vscode.TreeItem(req.name, vscode.TreeItemCollapsibleState.None);
      const overridden =
        !!state?.synced.linkedOverrides.requests[`${node.linkId}:${node.requestId}`];
      item.description = `${req.method}${overridden ? ' · modified' : ''}`;
      item.iconPath = new vscode.ThemeIcon(overridden ? 'edit' : 'symbol-method');
      item.contextValue = 'apicircleLinkedRequest';
      item.command = {
        command: 'apicircle.openLinkedRequest',
        title: 'Open linked request',
        arguments: [{ linkId: node.linkId, requestId: node.requestId }],
      };
      return item;
    }

    const item = new vscode.TreeItem(`v${node.version}`, vscode.TreeItemCollapsibleState.None);
    const tags = [node.deprecated ? 'deprecated' : '', node.yanked ? 'withdrawn' : '']
      .filter(Boolean)
      .join(' · ');
    if (tags) item.description = tags;
    item.iconPath = new vscode.ThemeIcon(
      node.yanked ? 'circle-slash' : node.deprecated ? 'warning' : 'tag',
    );
    // contextValue drives the per-version Deprecate / Withdraw context menu.
    item.contextValue = 'apicircleReleaseVersion';
    item.command = {
      command: 'apicircle.openReleaseHistory',
      title: 'Open release history',
    };
    return item;
  }

  private async linkedSummary(): Promise<string> {
    const active = this.bridge.activeWorkspace();
    if (!active) return 'none';
    const state = await active.read();
    const n = Object.keys(state.synced.linkedWorkspaces).length;
    return n === 0 ? 'none yet' : `${n} linked`;
  }

  private async releasesSummary(): Promise<string> {
    const active = this.bridge.activeWorkspace();
    if (!active) return 'no releases yet';
    const state = await active.read();
    const ledger = state.synced.releases.self;
    if (!ledger || ledger.versions.length === 0) return 'no releases yet';
    const plural = ledger.versions.length === 1 ? '' : 's';
    return `v${ledger.currentVersion} · ${ledger.versions.length} published version${plural}`;
  }
}
