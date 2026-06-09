import * as vscode from 'vscode';
import { BaseTreeView } from './BaseTreeView';

export interface MarketplaceNode {
  kind: 'workspace';
  id: string;
  label: string;
}

export class MarketplaceView extends BaseTreeView<MarketplaceNode> {
  readonly viewId = 'apicircle.marketplace';

  getTreeItem(node: MarketplaceNode): vscode.TreeItem {
    return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
  }

  getChildren(): MarketplaceNode[] {
    return []; // Phase 10 placeholder; gated by config.apicircle.enableMarketplace
  }
}
