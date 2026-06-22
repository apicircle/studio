import * as vscode from 'vscode';
import { BaseTreeView } from './BaseTreeView';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import { formatRequestRunDocument, formatPlanRunDocument } from '../execute/historyDocument';

// =============================================================================
// HistoryView — recent request runs + plan runs from WorkspaceLocal.history.
//
// Two top-level buckets:
//   ▾ Recent Requests
//      ✓ Get user · 200 · 142ms · 3m ago
//      ✗ Server error · 500 · 80ms · 5m ago
//      ◦ Untested req · 200 · 90ms · 6m ago
//   ▾ Recent Plans
//      ✗ Signup flow · 2/3 steps passed · 12m ago
//
// Click a run → opens its formatted YAML via apicircle://<ws>/history/<id>.yaml
// =============================================================================

export type HistoryNode =
  | { kind: 'bucket'; id: 'requests' | 'plans' }
  | { kind: 'request-run'; runId: string }
  | { kind: 'plan-run'; runId: string };

const MAX_PER_BUCKET = 100;

export class HistoryView extends BaseTreeView<HistoryNode> {
  readonly viewId = 'apicircle.history';

  constructor(
    private readonly bridge: VsCodeBridge,
    private readonly fsProvider: ApicircleFsProvider,
  ) {
    super();
  }

  async getTreeItem(element: HistoryNode): Promise<vscode.TreeItem> {
    const active = this.bridge.activeWorkspace();
    if (!active) return new vscode.TreeItem('No workspace');

    if (element.kind === 'bucket') {
      const state = await active.read();
      const count =
        element.id === 'requests'
          ? state.local.history.requestRuns.length
          : state.local.history.planRuns.length;
      const label = element.id === 'requests' ? 'Recent Requests' : 'Recent Plans';
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${count}`;
      item.iconPath = new vscode.ThemeIcon(element.id === 'requests' ? 'history' : 'list-ordered');
      item.contextValue = `bucket-${element.id}`;
      item.tooltip =
        element.id === 'requests'
          ? `${count} recent request run${count === 1 ? '' : 's'}. Use the bucket actions to clear or purge by date.`
          : `${count} recent plan run${count === 1 ? '' : 's'}. Use the bucket actions to clear or purge by date.`;
      return item;
    }

    const state = await active.read();
    if (element.kind === 'request-run') {
      const run = state.local.history.requestRuns.find((r) => r.id === element.runId);
      if (!run) return new vscode.TreeItem('(deleted run)');
      const verdict = computeVerdict(run.assertions, run.ok);
      const requestName = state.synced.collections.requests[run.requestId]?.name ?? run.requestId;
      const item = new vscode.TreeItem(
        truncate(requestName, 30),
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = `${verdict.glyph} ${run.status ?? 'err'} · ${run.durationMs}ms · ${ago(run.startedAt)}`;
      item.iconPath = new vscode.ThemeIcon(verdict.icon, new vscode.ThemeColor(verdict.color));
      item.tooltip = `${run.method} ${run.url}\n${run.statusText || run.error || ''}\nStarted: ${run.startedAt}`;
      item.contextValue = 'request-run';
      // Pre-populate the history store so the click opens instantly
      this.fsProvider.storeHistoryRun(run.id, formatRequestRunDocument(run));
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [ApicircleFsProvider.historyUri(active.workspace.id, run.id, requestName)],
      };
      return item;
    }

    // plan-run
    const planRun = state.local.history.planRuns.find((r) => r.id === element.runId);
    if (!planRun) return new vscode.TreeItem('(deleted run)');
    const passedSteps = planRun.steps.filter((s) => s.passed).length;
    const verdict = planRun.steps.every((s) => s.passed)
      ? { glyph: '✓', icon: 'check', color: 'charts.green' }
      : { glyph: '✗', icon: 'close', color: 'charts.red' };
    const planName = (state.synced.executionPlans ?? {})[planRun.planId]?.name ?? planRun.planId;
    const item = new vscode.TreeItem(truncate(planName, 30), vscode.TreeItemCollapsibleState.None);
    item.description = `${verdict.glyph} ${passedSteps}/${planRun.steps.length} steps · ${planRun.durationMs}ms · ${ago(planRun.startedAt)}`;
    item.iconPath = new vscode.ThemeIcon(verdict.icon, new vscode.ThemeColor(verdict.color));
    item.contextValue = 'plan-run';
    this.fsProvider.storeHistoryRun(
      planRun.id,
      formatPlanRunDocument(
        planRun,
        state.local.history.requestRuns,
        state.synced.collections.requests,
      ),
    );
    item.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [ApicircleFsProvider.historyUri(active.workspace.id, planRun.id, planName)],
    };
    return item;
  }

  async getChildren(element?: HistoryNode): Promise<HistoryNode[]> {
    const active = this.bridge.activeWorkspace();
    if (!active) return [];

    if (!element) {
      return [
        { kind: 'bucket', id: 'requests' },
        { kind: 'bucket', id: 'plans' },
      ];
    }

    if (element.kind === 'bucket') {
      const state = await active.read();
      if (element.id === 'requests') {
        return [...state.local.history.requestRuns]
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, MAX_PER_BUCKET)
          .map((r) => ({ kind: 'request-run' as const, runId: r.id }));
      }
      return [...state.local.history.planRuns]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, MAX_PER_BUCKET)
        .map((r) => ({ kind: 'plan-run' as const, runId: r.id }));
    }
    return [];
  }
}

function computeVerdict(
  assertions: ReadonlyArray<{ passed: boolean }>,
  ok: boolean,
): { glyph: string; icon: string; color: string } {
  if (assertions.length === 0) {
    return ok
      ? { glyph: '◦', icon: 'circle-outline', color: 'foreground' }
      : { glyph: '✗', icon: 'close', color: 'charts.red' };
  }
  return assertions.every((a) => a.passed)
    ? { glyph: '✓', icon: 'check', color: 'charts.green' }
    : { glyph: '✗', icon: 'close', color: 'charts.red' };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const seconds = Math.floor((Date.now() - t) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
