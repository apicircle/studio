import * as vscode from 'vscode';
import { runPlan, ANONYMOUS_ACTOR } from '@apicircle/core';
import { generateId } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { AbortRegistry } from '../execute/abortRegistry';
import type { InFlightPlanTracker } from '../execute/inFlightPlanTracker';

// =============================================================================
// Plan execution command.
//
// Runs the plan via `runPlan` from `@apicircle/core` — the same engine the
// desktop store + CLI + MCP server use. Wired knobs:
//   • withAssertions — picked up front (the same "Run" vs "Run with assertions"
//     split the Desktop / Web Execution panel offers); the ▶ CodeLens passes
//     it explicitly so no prompt appears.
//   • AbortSignal threaded through abortRegistry → `apicircle.cancelPlanRun`
//     (and the progress notification's Cancel button) abort mid-run.
//   • InFlightPlanTracker marks the plan URI in-flight so the plan CodeLens
//     swaps ▶ Run… → ⏳ Running… · ✖ Cancel.
//   • PlanRun history capped via setting.
//
// The plan's own `envPriorityOrder` (set via "Plan environments…") governs the
// run — there is no run-time env-override prompt. That matches Desktop / Web /
// the CLI, where the plan's configured env order is authoritative and a one-off
// override is an explicit edit, not an interactive question on every run.
//
// Plans live in `WorkspaceSynced.executionPlans` (shared via git); `runPlan`
// reads them straight off `state.synced`, so no lifting is needed here.
// =============================================================================

export interface PlanActionsDeps {
  bridge: VsCodeBridge;
  abortRegistry: AbortRegistry;
  /** When present, marks the plan URI in-flight so the CodeLens shows ⏳ · ✖ Cancel. */
  tracker?: InFlightPlanTracker;
}

interface PlanNode {
  kind: 'plan';
  id: string;
  /** When set, skips the with/without-assertions prompt (the ▶ CodeLens path). */
  withAssertions?: boolean;
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

  // Assertions choice — explicit from the ▶ CodeLens, else a two-option pick
  // mirroring the Desktop / Web "Run" vs "Run with assertions" buttons.
  let withAssertions = node?.withAssertions;
  if (withAssertions === undefined) {
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: '$(check) Run with assertions',
          description: "Evaluate each step's assertions and report pass / fail",
          value: true,
        },
        {
          label: '$(play) Run without assertions',
          description: 'Execute the steps only — no assertion checks',
          value: false,
        },
      ],
      { placeHolder: `Run plan "${plan.name}"` },
    );
    if (!pick) return;
    withAssertions = pick.value;
  }

  const runId = generateId();
  const signal = abortRegistry.register(runId);
  const cfg = vscode.workspace.getConfiguration('apicircle');
  const maxEntries = cfg.get<number>('history.maxEntriesPerWorkspace', 500);
  const retentionDays = cfg.get<number>('history.retentionDays', 30);

  try {
    // Mark the plan in-flight (keyed by id) so the CodeLens swaps to
    // ⏳ Running… · ✖ Cancel. Inside the try so the finally's `end` always pairs.
    deps.tracker?.start(plan.id, runId, plan.name);
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running plan "${plan.name}"${withAssertions ? '' : ' (no assertions)'}…`,
        cancellable: true,
      },
      async (_progress, token) => {
        token.onCancellationRequested(() => abortRegistry.cancel(runId));

        const result = await runPlan(state, plan.id, {
          withAssertions,
          actor: ANONYMOUS_ACTOR,
          signal,
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

        const executed = result.steps.filter((s) => !s.skipped);
        const verdict = withAssertions
          ? `${executed.filter((s) => s.passed).length}/${executed.length} steps passed`
          : `${executed.filter((s) => s.result?.ok).length}/${executed.length} requests succeeded (no assertions)`;
        // Fire-and-forget. NEVER `await` a notification inside withProgress: a
        // plain info toast's promise only settles when the toast is dismissed,
        // so awaiting it keeps the "Running…" progress (and therefore the
        // in-flight tracker + the ⏳ Running CodeLens) alive long after the run
        // actually finished — the "stuck on Running" bug.
        void vscode.window.showInformationMessage(`Plan "${plan.name}" finished — ${verdict}.`);
      },
    );
  } catch (e) {
    abortRegistry.complete(runId);
    if (signal.aborted) {
      void vscode.window.showInformationMessage(`Plan "${plan.name}" was cancelled.`);
      return;
    }
    void vscode.window.showErrorMessage(
      `Plan run failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    deps.tracker?.end(plan.id);
  }
}
