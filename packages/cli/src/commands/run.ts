import * as os from 'node:os';
import type { Command } from 'commander';
import kleur from 'kleur';
import {
  ANONYMOUS_ACTOR,
  PlanRunDeniedError,
  resolvePlanRef,
  runPlan,
  type PlanRunAuthorizationContext,
  type PlanStepResult,
  type RunActor,
  type RunPlanResult,
} from '@apicircle/core';
import { loadFromFile, saveToFile } from '@apicircle/core/workspace/file-backed';
import type { ExecutionPlan, WorkspaceLocal } from '@apicircle/shared';
import { buildSecretsFromCli } from '../util/secrets';
import { resolveWorkspace, WorkspaceResolutionError } from '../util/resolveWorkspace';
import {
  prepareExecutionAttachments,
  type AttachmentPreparationSummary,
  type PreparedExecutionAttachments,
} from '../util/executionAttachments';

// =============================================================================
// `apicircle run <plan>` — execute a saved execution plan headlessly and print
// a pass/fail report. Sits alongside `apicircle mock` and `apicircle mcp` as
// the third runtime entry point. Drives the runtime-agnostic engine in
// `@apicircle/core` (`runPlan`), so the CLI owns only argument parsing,
// workspace IO, runner-identity resolution, and report formatting.
//
// Exit codes:
//   0  every executed step passed
//   1  the plan ran but a step failed (or the run was aborted)
//   2  usage error — no workspace, unknown plan, bad option
//   3  the run was denied by the authorization gate
// =============================================================================

const REPORTERS = ['text', 'json', 'junit'] as const;
type Reporter = (typeof REPORTERS)[number];

interface RunOptions {
  workspaceName?: string;
  workspacePath?: string;
  /** Commander sets this `false` when `--no-assertions` is passed. */
  assertions?: boolean;
  secrets?: string;
  /** Commander sets this `false` when `--no-save` is passed. */
  save?: boolean;
  reporter?: string;
  bail?: boolean;
  env?: string;
  as?: string;
}

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Run a saved execution plan from a workspace and report the result')
    .argument('<plan>', 'Plan name or id to run')
    .option(
      '--workspace-name <name-or-id>',
      'Registry workspace name (case-insensitive) or id. Defaults to the active workspace.',
    )
    .option(
      '--workspace-path <dir>',
      'Filesystem directory containing workspace.synced.json (skips the registry).',
    )
    .option('--no-assertions', 'Run requests without evaluating their assertions')
    .option('-s, --secrets <file>', 'JSON file mapping secretKeyId → plaintext value')
    .option('--no-save', 'Do not write the plan run to workspace history')
    .option('--reporter <format>', 'Report format: text | json | junit', 'text')
    .option('--bail', 'Stop the run at the first failed step')
    .option('-e, --env <name>', 'Layer a local environment on top of the run')
    .option('--as <actor>', 'Override the recorded runner identity')
    .action(async (planRef: string, opts: RunOptions) => {
      let dir: string;
      try {
        const resolved = await resolveWorkspace({
          name: opts.workspaceName,
          path: opts.workspacePath,
          expectExists: false,
        });
        dir = resolved.dir;
        if (resolved.fromRegistry) {
          process.stderr.write(
            `${kleur.dim('workspace')}: ${kleur.cyan(resolved.name ?? resolved.id ?? '')} ${kleur.dim(`(${dir})`)}\n`,
          );
        }
      } catch (err) {
        if (err instanceof WorkspaceResolutionError) {
          fail(err.message);
          return;
        }
        throw err;
      }

      const reporter = opts.reporter ?? 'text';
      if (!isReporter(reporter)) {
        fail(`unknown --reporter "${reporter}" (expected: ${REPORTERS.join(', ')})`);
        return;
      }

      const state = await loadFromFile(dir, { allowMissing: true });
      if (!state) {
        fail(`no workspace found at ${dir} (expected workspace.synced.json)`);
        return;
      }

      const ref = resolvePlanRef(state.synced, planRef);
      if (!ref.ok) {
        fail(ref.error);
        if (ref.available.length > 0) {
          process.stderr.write(`Available plans: ${ref.available.join(', ')}\n`);
        }
        return;
      }

      if (opts.env && !state.synced.environments.items[opts.env]) {
        const names = Object.keys(state.synced.environments.items);
        fail(`no environment named "${opts.env}" in this workspace`);
        if (names.length > 0) {
          process.stderr.write(`Available environments: ${names.join(', ')}\n`);
        }
        return;
      }

      let secretsById: Record<string, string>;
      try {
        secretsById = (await buildSecretsFromCli({ secretsFile: opts.secrets })).byId;
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        return;
      }

      const actor = resolveActor(state.local, opts.as);
      const withAssertions = opts.assertions !== false;
      const text = reporter === 'text';

      // Ctrl+C aborts gracefully between steps (and the in-flight request)
      // rather than killing the process — the partial run is still reported.
      const controller = new AbortController();
      const onSigint = (): void => controller.abort(new Error('aborted by SIGINT'));
      process.on('SIGINT', onSigint);

      if (text) process.stdout.write(formatHeader(ref.plan, actor, withAssertions, opts));

      let prepared: PreparedExecutionAttachments;
      try {
        prepared = await prepareExecutionAttachments(dir, state, ref.plan);
      } catch (err) {
        process.off('SIGINT', onSigint);
        fail(err instanceof Error ? err.message : String(err), 1, 'attachment');
        return;
      }
      if (text && prepared.summary.total > 0) {
        process.stdout.write(formatAttachmentPreparation(prepared.summary));
      }

      let result: RunPlanResult;
      try {
        result = await runPlan(prepared.state, ref.id, {
          withAssertions,
          bail: opts.bail === true,
          env: opts.env,
          secretsById,
          actor,
          signal: controller.signal,
          resolveAttachment: prepared.resolveAttachment,
          authorize: checkRunPermission,
          onStep: text ? (step) => process.stdout.write(formatStepLine(step)) : undefined,
        });
      } catch (err) {
        process.off('SIGINT', onSigint);
        if (err instanceof PlanRunDeniedError) {
          fail(err.message, 3, 'denied');
          return;
        }
        throw err;
      }
      process.off('SIGINT', onSigint);

      const aborted = controller.signal.aborted;
      const saved = opts.save !== false;
      if (saved) await saveToFile(dir, result.nextState);

      if (reporter === 'json') {
        process.stdout.write(
          JSON.stringify(
            buildJsonReport(dir, ref.id, ref.plan, actor, result, saved, aborted, prepared.summary),
            null,
            2,
          ) + '\n',
        );
      } else if (reporter === 'junit') {
        process.stdout.write(buildJunitReport(ref.plan, result));
      } else {
        process.stdout.write(formatSummary(result, saved, aborted));
      }

      // An aborted run is never a pass, even if the steps that ran all passed.
      process.exitCode = result.passed && !aborted ? 0 : 1;
    });
}

function isReporter(value: string): value is Reporter {
  return (REPORTERS as readonly string[]).includes(value);
}

/**
 * Best-effort identity of whoever launched the run. Precedence: an explicit
 * `--as` override, then the workspace's GitHub session login, then the OS
 * username. Recorded for display and handed to {@link checkRunPermission}.
 */
export function resolveActor(local: WorkspaceLocal, override?: string): RunActor {
  const explicit = override?.trim();
  if (explicit) return { kind: 'unknown', name: explicit };

  const login = local.sessions.github.workspace?.accountLogin;
  if (login) return { kind: 'github', name: login };

  try {
    const username = os.userInfo().username;
    if (username) return { kind: 'os', name: username };
  } catch {
    // os.userInfo() throws when the uid has no passwd entry (some containers).
  }
  return ANONYMOUS_ACTOR;
}

/**
 * Authorization gate for `apicircle run`. Today every actor may run every
 * plan — this is intentionally permissive. When per-user run restrictions
 * land, enforce them here: inspect `ctx.actor` + `ctx.plan` and throw a
 * `PlanRunDeniedError` to block the run before any HTTP request fires. It is
 * wired into `runPlan` via the `authorize` option, so a denial is caught and
 * reported with exit code 3.
 */
function checkRunPermission(_ctx: PlanRunAuthorizationContext): void {
  // FUTURE: per-user run authorization. Throw PlanRunDeniedError to deny.
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

function formatHeader(
  plan: ExecutionPlan,
  actor: RunActor,
  withAssertions: boolean,
  opts: RunOptions,
): string {
  const enabled = plan.steps.filter((s) => s.enabled !== false).length;
  const flags = [
    withAssertions ? 'assertions on' : 'assertions off',
    opts.bail ? 'bail' : null,
    opts.env ? `env=${opts.env}` : null,
  ].filter((f): f is string => f !== null);
  return (
    `${kleur.bold('Plan')} ${plan.name}  ${kleur.dim(
      `(${enabled}/${plan.steps.length} steps · ${flags.join(' · ')})`,
    )}\n` + `${kleur.dim('Run by')} ${actor.name} ${kleur.dim(`(${actor.kind})`)}\n\n`
  );
}

function formatAttachmentPreparation(summary: AttachmentPreparationSummary): string {
  const status = `${summary.downloaded} downloaded, ${summary.alreadyPresent} already local`;
  const lines = [
    `${kleur.bold('Attachments')} ${summary.total} required ${kleur.dim(
      `(${status} - ${summary.cacheDir})`,
    )}`,
  ];
  for (const entry of summary.entries) {
    const source =
      entry.source === 'linked-workspace'
        ? `linked:${entry.linkedWorkspaceId ?? 'unknown'}`
        : 'workspace';
    const requiredBy = entry.requiredBy.map((item) => item.requestName).join(', ');
    lines.push(
      `  ${kleur.dim('file')} ${entry.filename} ${kleur.dim(
        `${source} - ${requiredBy} - ${entry.localPath}`,
      )}`,
    );
  }
  return `${lines.join('\n')}\n\n`;
}

export function formatStepLine(step: PlanStepResult): string {
  const n = `${step.stepIndex + 1}.`.padEnd(3);
  const method = (step.requestMethod || '—').padEnd(7);

  if (step.skipped) {
    return `  ${kleur.dim('–')} ${kleur.dim(n)} ${kleur.dim(method)} ${kleur.dim(
      `${step.requestName}  skipped`,
    )}\n`;
  }

  const mark = step.passed ? kleur.green('✓') : kleur.red('✗');
  const status = step.result?.status != null ? String(step.result.status) : '—';
  const duration = step.result ? `${step.result.durationMs}ms` : '';
  const name = step.requestName.padEnd(28);

  let line = `  ${mark} ${n} ${method} ${name} ${status.padEnd(4)} ${kleur.dim(duration)}`;

  if (step.assertionResults.length > 0) {
    const passed = step.assertionResults.filter((a) => a.passed).length;
    line += `  ${kleur.dim(`${passed}/${step.assertionResults.length} assertions`)}`;
  }
  line += '\n';

  if (step.error) {
    line += `      ${kleur.red(step.error)}\n`;
  }
  for (const a of step.assertionResults) {
    if (!a.passed) line += `      ${kleur.red('✗')} ${a.detail ?? `${a.kind} ${a.op}`}\n`;
  }
  if (step.missingVariables.length > 0) {
    line += `      ${kleur.yellow('⚠')} unresolved: ${step.missingVariables
      .map((v) => `{{${v}}}`)
      .join(', ')}\n`;
  }
  return line;
}

function tally(result: RunPlanResult): { passed: number; failed: number; skipped: number } {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const s of result.steps) {
    if (s.skipped) skipped++;
    else if (s.passed) passed++;
    else failed++;
  }
  return { passed, failed, skipped };
}

function formatSummary(result: RunPlanResult, saved: boolean, aborted: boolean): string {
  if (result.steps.length === 0) {
    return `\n${kleur.yellow('Plan has no steps.')}\n`;
  }
  const { passed, failed, skipped } = tally(result);
  const parts = [
    kleur.green(`${passed} passed`),
    failed > 0 ? kleur.red(`${failed} failed`) : kleur.dim(`${failed} failed`),
    kleur.dim(`${skipped} skipped`),
  ];
  const verdict = result.passed && !aborted ? kleur.green('PASS') : kleur.red('FAIL');
  let out = `\n${verdict}  ${parts.join(kleur.dim(' · '))}  ${kleur.dim(
    `· ${result.planRun.durationMs}ms`,
  )}\n`;
  if (aborted) out += `${kleur.yellow('Run aborted before every step finished.')}\n`;
  out += saved
    ? kleur.dim('Plan run saved to workspace history.\n')
    : kleur.dim('Plan run not saved (--no-save).\n');
  return out;
}

function buildJsonReport(
  workspace: string,
  planId: string,
  plan: ExecutionPlan,
  actor: RunActor,
  result: RunPlanResult,
  saved: boolean,
  aborted: boolean,
  attachments: AttachmentPreparationSummary,
): unknown {
  return {
    workspace,
    plan: { id: planId, name: plan.name },
    actor,
    withAssertions: result.planRun.withAssertions,
    passed: result.passed && !aborted,
    aborted,
    durationMs: result.planRun.durationMs,
    saved,
    attachments,
    counts: tally(result),
    steps: result.steps.map((s) => ({
      step: s.stepIndex + 1,
      request: s.requestName,
      method: s.requestMethod,
      skipped: s.skipped,
      status: s.result?.status ?? null,
      ok: s.result?.ok ?? false,
      durationMs: s.result?.durationMs ?? 0,
      passed: s.passed,
      error: s.error ?? null,
      missingVariables: s.missingVariables,
      assertions: s.assertionResults.map((a) => ({
        kind: a.kind,
        op: a.op,
        target: a.target,
        expected: a.expected,
        passed: a.passed,
        detail: a.detail,
      })),
    })),
  };
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** JUnit XML — consumable by CI dashboards as a plan-run review gate. */
export function buildJunitReport(plan: ExecutionPlan, result: RunPlanResult): string {
  const { failed, skipped } = tally(result);
  const total = result.steps.length;
  const suite = xmlEscape(plan.name);
  const suiteTime = (result.planRun.durationMs / 1000).toFixed(3);

  const cases = result.steps.map((s) => {
    const name = xmlEscape(`${s.stepIndex + 1}. ${s.requestName}`);
    const time = ((s.result?.durationMs ?? 0) / 1000).toFixed(3);
    const open = `    <testcase name="${name}" classname="${suite}" time="${time}"`;
    if (s.skipped) return `${open}>\n      <skipped/>\n    </testcase>`;
    if (s.passed) return `${open}/>`;

    const reasons: string[] = [];
    if (s.error) reasons.push(s.error);
    for (const a of s.assertionResults) {
      if (!a.passed) reasons.push(a.detail ?? `assertion ${a.kind} ${a.op} failed`);
    }
    if (s.result && !s.result.ok && s.result.status != null) {
      reasons.push(`HTTP ${s.result.status}`);
    }
    const detail = xmlEscape(reasons.join('\n') || 'step failed');
    const summary = detail.split('\n')[0];
    return `${open}>\n      <failure message="${summary}">${detail}</failure>\n    </testcase>`;
  });

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<testsuites name="${suite}" tests="${total}" failures="${failed}" skipped="${skipped}" time="${suiteTime}">\n` +
    `  <testsuite name="${suite}" tests="${total}" failures="${failed}" skipped="${skipped}" time="${suiteTime}">\n` +
    `${cases.join('\n')}\n` +
    '  </testsuite>\n' +
    '</testsuites>\n'
  );
}

/** Write a CLI error to stderr and set the exit code. `kind` colours the prefix. */
function fail(message: string, code = 2, kind = 'error'): void {
  process.stderr.write(`${kleur.red(kind)}: ${message}\n`);
  process.exitCode = code;
}
