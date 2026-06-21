import * as vscode from 'vscode';
import { runPlan, ANONYMOUS_ACTOR } from '@apicircle/core';
import { generateId } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { AbortRegistry } from '../execute/abortRegistry';

// =============================================================================
// Plan execution command.
//
// Runs the plan via `runPlan` from `@apicircle/core` — the same engine the
// desktop store + CLI + MCP server use. Wired knobs:
//   • AbortSignal threaded through abortRegistry → `apicircle.cancelSend`
//     cancels mid-run (gap #7).
//   • PlanRun history capped via setting (gap #8).
//   • Optional env override via QuickPick (gap #20).
//
// Plans live in `WorkspaceSynced.executionPlans` (shared via git); `runPlan`
// reads them straight off `state.synced`, so no lifting is needed here.
// =============================================================================

export interface PlanActionsDeps {
  bridge: VsCodeBridge;
  abortRegistry: AbortRegistry;
}

interface PlanNode {
  kind: 'plan';
  id: string;
}

export async function runPlanCommand(deps: PlanActionsDeps, node?: PlanNode): Promise<void> {
  const { bridge, abortRegistry } = deps;
  const active = bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }

  const state = await active.read();
  const plans = state.synced.executionPlans ?? {};
  const planList = Object.values(plans);
  if (planList.length === 0) {
    await vscode.window.showInformationMessage(
      'No execution plans defined. Run "API Circle: New Plan…" first.',
    );
    return;
  }

  let planId = node?.id;
  if (!planId) {
    const picked = await vscode.window.showQuickPick(
      planList.map((p) => ({ label: p.name, description: `${p.steps.length} steps`, id: p.id })),
      { placeHolder: 'Pick a plan to run' },
    );
    if (!picked) return;
    planId = picked.id;
  }

  const plan = plans[planId];
  if (!plan) {
    await vscode.window.showErrorMessage(`Plan ${planId} no longer exists.`);
    return;
  }

  // Optional env override (gap #20)
  const envs = Object.values(state.synced.environments.items);
  let envOverride: string | undefined;
  if (envs.length > 0) {
    const envPick = await vscode.window.showQuickPick(
      [
        { label: '$(circle-slash) (no override)', name: undefined as string | undefined },
        ...envs.map((e) => ({ label: e.name, name: e.name })),
      ],
      { placeHolder: 'Run with an env overlay? (optional — highest precedence)' },
    );
    if (envPick === undefined) return;
    envOverride = envPick.name;
  }

  const runId = generateId();
  const signal = abortRegistry.register(runId);
  const cfg = vscode.workspace.getConfiguration('apicircle');
  const maxEntries = cfg.get<number>('history.maxEntriesPerWorkspace', 500);
  const retentionDays = cfg.get<number>('history.retentionDays', 30);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running plan "${plan.name}"${envOverride ? ` with env: ${envOverride}` : ''}…`,
        cancellable: true,
      },
      async (_progress, token) => {
        token.onCancellationRequested(() => abortRegistry.cancel(runId));

        const result = await runPlan(state, plan.id, {
          withAssertions: true,
          actor: ANONYMOUS_ACTOR,
          signal,
          env: envOverride,
        });
        abortRegistry.complete(runId);

        // Trim history per user's settings on top of runPlan's internal cap.
        // retentionDays (≤0 = no time cap) prunes by age FIRST; then maxEntries
        // caps the final size. Both apply to request + plan run buckets.
        const next = result.nextState;
        const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 86_400_000 : null;
        const inWindow = (iso: string): boolean => {
          if (cutoff === null) return true;
          const t = Date.parse(iso);
          return Number.isNaN(t) ? true : t >= cutoff;
        };
        await active.write({
          synced: next.synced,
          local: {
            ...next.local,
            history: {
              ...next.local.history,
              requestRuns: next.local.history.requestRuns
                .filter((r) => inWindow(r.startedAt))
                .slice(0, maxEntries),
              planRuns: next.local.history.planRuns
                .filter((r) => inWindow(r.startedAt))
                .slice(0, maxEntries),
            },
          },
        });

        const passedSteps = result.steps.filter((s) =>
          (s.assertionResults ?? []).every((a) => a.passed),
        ).length;
        await vscode.window.showInformationMessage(
          `Plan "${plan.name}" finished — ${passedSteps}/${result.steps.length} steps passed.`,
        );
      },
    );
  } catch (e) {
    abortRegistry.complete(runId);
    if (signal.aborted) {
      await vscode.window.showInformationMessage(`Plan "${plan.name}" was cancelled.`);
      return;
    }
    await vscode.window.showErrorMessage(
      `Plan run failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
