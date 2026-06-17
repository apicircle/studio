import * as vscode from 'vscode';

// =============================================================================
// BaseTreeView — shared abstract base for every APICircle sidebar TreeView.
//
// Provides:
//   • A typed onDidChangeTreeData event emitter
//   • A refresh() method that re-fires the event
//   • A registerView() helper that pins disposables to the extension context
//
// Each concrete view subclasses this and overrides getTreeItem / getChildren.
// =============================================================================

export abstract class BaseTreeView<T> implements vscode.TreeDataProvider<T> {
  protected readonly _onDidChangeTreeData = new vscode.EventEmitter<T | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<T | undefined | void> =
    this._onDidChangeTreeData.event;

  abstract readonly viewId: string;
  abstract getTreeItem(element: T): vscode.TreeItem | Thenable<vscode.TreeItem>;
  abstract getChildren(element?: T): vscode.ProviderResult<T[]>;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  refreshElement(element: T): void {
    this._onDidChangeTreeData.fire(element);
  }

  /** Register this provider against vscode.window and return the disposable. */
  register(context: vscode.ExtensionContext): vscode.Disposable {
    const view = vscode.window.createTreeView(this.viewId, {
      treeDataProvider: this,
      showCollapseAll: true,
    });
    context.subscriptions.push(view);
    context.subscriptions.push(this._onDidChangeTreeData);
    return view;
  }
}
