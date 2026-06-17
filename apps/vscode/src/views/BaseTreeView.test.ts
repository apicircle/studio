import { describe, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import { BaseTreeView } from './BaseTreeView';

class ConcreteView extends BaseTreeView<{ id: string; label: string }> {
  readonly viewId = 'test.view';
  // Test override returns the mock TreeItem; cast through unknown since the
  // mock's structural type isn't 1:1 with the real vscode.TreeItem.
  getTreeItem(): vscode.TreeItem {
    return { label: 'x' } as unknown as vscode.TreeItem;
  }
  getChildren(): { id: string; label: string }[] {
    return [];
  }
}

describe('BaseTreeView', () => {
  it('refresh() fires onDidChangeTreeData with undefined', () => {
    const view = new ConcreteView();
    const listener = vi.fn();
    view.onDidChangeTreeData(listener);
    view.refresh();
    expect(listener).toHaveBeenCalledWith(undefined);
  });

  it('refreshElement() fires onDidChangeTreeData with the element', () => {
    const view = new ConcreteView();
    const listener = vi.fn();
    view.onDidChangeTreeData(listener);
    const el = { id: 'a', label: 'A' };
    view.refreshElement(el);
    expect(listener).toHaveBeenCalledWith(el);
  });

  it('exposes the correct viewId for VS Code registration', () => {
    expect(new ConcreteView().viewId).toBe('test.view');
  });
});
