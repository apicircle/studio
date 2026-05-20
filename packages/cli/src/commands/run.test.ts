import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import type { PlanStepResult, RunPlanResult } from '@apicircle/core';
import type { ExecutionPlan, GitHubSession, WorkspaceLocal } from '@apicircle/shared';
import { buildJunitReport, formatStepLine, registerRunCommand, resolveActor } from './run';

function makeLocal(session: GitHubSession | null = null): WorkspaceLocal {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    executionPlans: {},
    history: { requestRuns: [], planRuns: [] },
    secretIndex: { entries: {} },
    sessions: { github: { workspace: session, links: {} } },
    connectedRepo: null,
    workingBranch: null,
    seededWorkspaceSha: null,
    retiredBranch: null,
    sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
    linkedCollections: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: {
      activeRequestId: null,
      sidebarExpandedSections: [],
      themeId: 'studio-dark',
      fontId: 'system-mono',
      fontSizePercent: 100,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
}

function makeSession(accountLogin: string): GitHubSession {
  return {
    accountLogin,
    tokenSecretId: 'sec-1',
    grantedScopes: ['repo'],
    addedAt: '2026-05-01T00:00:00.000Z',
    lastVerifiedAt: null,
    canCreatePullRequests: null,
  };
}

function makeStep(partial: Partial<PlanStepResult> = {}): PlanStepResult {
  return {
    stepIndex: 0,
    requestId: 'r1',
    requestName: 'Health check',
    requestMethod: 'GET',
    skipped: false,
    result: {
      startedAt: '2026-05-01T00:00:00.000Z',
      durationMs: 42,
      status: 200,
      ok: true,
      statusText: 'OK',
      headers: {},
      body: '{}',
      bodyKind: 'json',
      url: 'https://api.test/health',
      method: 'GET',
      authWarnings: [],
    },
    assertionResults: [],
    missingVariables: [],
    passed: true,
    ...partial,
  };
}

describe('resolveActor', () => {
  it('prefers an explicit --as override', () => {
    expect(resolveActor(makeLocal(makeSession('octocat')), 'release-bot')).toEqual({
      kind: 'unknown',
      name: 'release-bot',
    });
  });

  it('falls back to the GitHub session login', () => {
    expect(resolveActor(makeLocal(makeSession('octocat')))).toEqual({
      kind: 'github',
      name: 'octocat',
    });
  });

  it('falls back to the OS user when there is no session', () => {
    const actor = resolveActor(makeLocal(null));
    // The OS user is environment-dependent; assert the shape rather than a name.
    expect(['os', 'unknown']).toContain(actor.kind);
    expect(typeof actor.name).toBe('string');
  });

  it('ignores a blank override', () => {
    expect(resolveActor(makeLocal(makeSession('octocat')), '   ')).toEqual({
      kind: 'github',
      name: 'octocat',
    });
  });
});

describe('formatStepLine', () => {
  it('marks a passing step with a check and its status', () => {
    const line = formatStepLine(makeStep());
    expect(line).toContain('✓');
    expect(line).toContain('Health check');
    expect(line).toContain('200');
  });

  it('renders skipped steps as skipped', () => {
    const line = formatStepLine(makeStep({ skipped: true, result: null }));
    expect(line).toContain('skipped');
  });

  it('shows assertion failure detail for a failing step', () => {
    const line = formatStepLine(
      makeStep({
        passed: false,
        result: { ...makeStep().result!, status: 500, ok: false },
        assertionResults: [
          {
            assertionId: 'a1',
            kind: 'status',
            op: 'equals',
            expected: 200,
            passed: false,
            detail: 'status: 500 does not equal 200',
          },
        ],
      }),
    );
    expect(line).toContain('✗');
    expect(line).toContain('does not equal 200');
  });

  it('surfaces unresolved variables', () => {
    const line = formatStepLine(makeStep({ missingVariables: ['TOKEN'] }));
    expect(line).toContain('{{TOKEN}}');
  });

  it('surfaces a step-level error', () => {
    const line = formatStepLine(
      makeStep({ passed: false, result: null, error: 'Request no longer exists in workspace.' }),
    );
    expect(line).toContain('no longer exists');
  });
});

describe('buildJunitReport', () => {
  const plan: ExecutionPlan = {
    id: 'p1',
    name: 'Smoke & Co',
    steps: [],
    envPriorityOrder: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };

  function result(steps: PlanStepResult[]): RunPlanResult {
    return {
      planRun: {
        id: 'pr1',
        planId: 'p1',
        startedAt: '2026-05-01T00:00:00.000Z',
        durationMs: 130,
        withAssertions: true,
        steps: [],
      },
      steps,
      nextState: { synced: {}, local: {} } as unknown as RunPlanResult['nextState'],
      passed: false,
    };
  }

  it('emits a well-formed testsuite with pass / fail / skip cases', () => {
    const xml = buildJunitReport(
      plan,
      result([
        makeStep(),
        makeStep({
          stepIndex: 1,
          requestName: 'Fetch me',
          passed: false,
          result: { ...makeStep().result!, status: 500, ok: false },
          assertionResults: [
            {
              assertionId: 'a1',
              kind: 'status',
              op: 'equals',
              expected: 200,
              passed: false,
              detail: 'status: 500 does not equal 200',
            },
          ],
        }),
        makeStep({ stepIndex: 2, requestName: 'Cleanup', skipped: true, result: null }),
      ]),
    );
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('tests="3" failures="1" skipped="1"');
    expect(xml).toContain('<failure message="status: 500 does not equal 200">');
    expect(xml).toContain('<skipped/>');
    // The plan name is XML-escaped in attributes.
    expect(xml).toContain('name="Smoke &amp; Co"');
  });
});

describe('registerRunCommand', () => {
  it('adds a `run` command with a required plan argument', () => {
    const program = new Command();
    registerRunCommand(program);
    const run = program.commands.find((c) => c.name() === 'run');
    expect(run).toBeDefined();
    expect(run?.usage()).toContain('<plan>');
  });

  it('exposes the workbook-specified flags', () => {
    const program = new Command();
    registerRunCommand(program);
    const run = program.commands.find((c) => c.name() === 'run');
    const flags = run?.options.map((o) => o.long) ?? [];
    expect(flags).toEqual(
      expect.arrayContaining(['--reporter', '--bail', '--env', '--secrets', '--no-save']),
    );
  });
});
