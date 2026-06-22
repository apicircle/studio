import { describe, it, expect } from 'vitest';
import { serializePlanToYaml, parsePlanFromYaml, PlanYamlParseError } from './planYaml';
import type { ExecutionPlan } from '@apicircle/shared';

function makePlan(over: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    id: 'plan-1',
    name: 'Smoke test',
    steps: [
      { requestId: 'req-a', enabled: true },
      { requestId: 'req-b', enabled: false },
    ],
    envPriorityOrder: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('serializePlanToYaml', () => {
  it('emits a header comment', () => {
    const out = serializePlanToYaml(makePlan());
    expect(out).toContain('API Circle Execution Plan');
  });

  it('emits steps with requestId + enabled when false', () => {
    const out = serializePlanToYaml(makePlan());
    expect(out).toContain('requestId: req-a');
    expect(out).toContain('requestId: req-b');
    expect(out).toContain('enabled: false');
  });

  it('omits enabled when default true', () => {
    const out = serializePlanToYaml(makePlan({ steps: [{ requestId: 'r1', enabled: true }] }));
    // Step is enabled: true (default) — omit field for cleaner diffs
    expect(out).not.toContain('enabled: true');
  });

  it('annotates each step with the resolved name · method · folder comment', () => {
    const out = serializePlanToYaml(makePlan(), (step) =>
      step.requestId === 'req-a' ? 'Login · POST · Auth / Onboarding' : 'Get profile · GET',
    );
    expect(out).toContain('# Login · POST · Auth / Onboarding');
    expect(out).toContain('# Get profile · GET');
    // The requestId stays the canonical key beneath the comment.
    expect(out).toContain('requestId: req-a');
  });

  it('round-trips: the step-label comments are ignored by the parser', () => {
    const out = serializePlanToYaml(makePlan(), () => 'Some · Label · Folder');
    const parsed = parsePlanFromYaml(out);
    expect(parsed.plan.steps.map((s) => s.requestId)).toEqual(['req-a', 'req-b']);
    expect(parsed.plan.steps[1].enabled).toBe(false);
  });

  it('emits stopOnAssertionFailure only when true', () => {
    const off = serializePlanToYaml(makePlan({ stopOnAssertionFailure: false }));
    expect(off).not.toContain('stopOnAssertionFailure');
    const on = serializePlanToYaml(makePlan({ stopOnAssertionFailure: true }));
    expect(on).toContain('stopOnAssertionFailure: true');
  });

  it('emits variables when non-empty', () => {
    const out = serializePlanToYaml(makePlan({ variables: [{ key: 'base', value: 'https://x' }] }));
    expect(out).toContain('variables:');
    expect(out).toContain('key: base');
    expect(out).toContain('value: https://x');
  });

  it('emits envPriorityOrder with local + linked refs', () => {
    const out = serializePlanToYaml(
      makePlan({
        envPriorityOrder: [
          { kind: 'local', name: 'prod' },
          { kind: 'linked', linkedWorkspaceId: 'ws-1', envName: 'shared' },
        ],
      }),
    );
    expect(out).toContain('local: prod');
    expect(out).toContain('workspaceId: ws-1');
    expect(out).toContain('envName: shared');
  });
});

describe('parsePlanFromYaml', () => {
  it('throws PlanYamlParseError for invalid YAML', () => {
    expect(() => parsePlanFromYaml(':: !! not yaml')).toThrow(PlanYamlParseError);
  });

  it('throws when root is not a mapping', () => {
    expect(() => parsePlanFromYaml('- a\n- b')).toThrow(PlanYamlParseError);
  });

  it('throws when name is missing', () => {
    expect(() => parsePlanFromYaml('steps: []')).toThrow(PlanYamlParseError);
  });

  it('parses steps array preserving enabled', () => {
    const yaml = `name: Smoke
steps:
  - requestId: r1
  - requestId: r2
    enabled: false
`;
    const { plan } = parsePlanFromYaml(yaml);
    expect(plan.steps).toEqual([
      { requestId: 'r1', enabled: true },
      { requestId: 'r2', enabled: false },
    ]);
  });

  it('warns on malformed step rows and skips them', () => {
    const yaml = `name: Smoke
steps:
  - requestId: ok
  - {}
  - "not an object"
`;
    const { plan, warnings } = parsePlanFromYaml(yaml);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].requestId).toBe('ok');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('parses envPriorityOrder local + linked refs', () => {
    const yaml = `name: Smoke
steps: []
envPriorityOrder:
  - local: prod
  - linked:
      workspaceId: ws-1
      envName: shared
`;
    const { plan } = parsePlanFromYaml(yaml);
    expect(plan.envPriorityOrder).toEqual([
      { kind: 'local', name: 'prod' },
      { kind: 'linked', linkedWorkspaceId: 'ws-1', envName: 'shared' },
    ]);
  });

  it('parses plan variables', () => {
    const yaml = `name: Smoke
steps: []
variables:
  - key: base
    value: https://x
  - key: k2
    value: v2
`;
    const { plan } = parsePlanFromYaml(yaml);
    expect(plan.variables).toEqual([
      { key: 'base', value: 'https://x' },
      { key: 'k2', value: 'v2' },
    ]);
  });

  it('omits variables field when array is empty', () => {
    const yaml = `name: Smoke
steps: []
variables: []
`;
    const { plan } = parsePlanFromYaml(yaml);
    expect(plan.variables).toBeUndefined();
  });

  it('reads stopOnAssertionFailure as boolean', () => {
    const yaml = `name: Smoke
steps: []
stopOnAssertionFailure: true
`;
    const { plan } = parsePlanFromYaml(yaml);
    expect(plan.stopOnAssertionFailure).toBe(true);
  });

  it('warns when steps is not an array', () => {
    const { plan, warnings } = parsePlanFromYaml('name: Smoke\nsteps: "not-list"\n');
    expect(plan.steps).toEqual([]);
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('steps')]));
  });

  it('warns and skips non-object step rows', () => {
    const yaml = 'name: Smoke\nsteps:\n  - "bare string"\n';
    const { plan, warnings } = parsePlanFromYaml(yaml);
    expect(plan.steps).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('includes linkedWorkspaceId on steps when present', () => {
    const yaml = `name: Smoke
steps:
  - requestId: r1
    linkedWorkspaceId: lw-1
`;
    const { plan } = parsePlanFromYaml(yaml);
    expect(plan.steps[0].linkedWorkspaceId).toBe('lw-1');
  });

  it('warns when envPriorityOrder is not an array', () => {
    const { warnings } = parsePlanFromYaml('name: Smoke\nsteps: []\nenvPriorityOrder: "nope"\n');
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('envPriorityOrder')]));
  });

  it('warns and skips non-object envPriorityOrder rows', () => {
    const yaml = 'name: Smoke\nsteps: []\nenvPriorityOrder:\n  - 42\n';
    const { warnings } = parsePlanFromYaml(yaml);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('warns on unrecognized envPriorityOrder shape', () => {
    const yaml = 'name: Smoke\nsteps: []\nenvPriorityOrder:\n  - neither: local\n';
    const { warnings } = parsePlanFromYaml(yaml);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/envPriorityOrder\[0\]/)]),
    );
  });

  it('warns when variables is not an array', () => {
    const { plan, warnings } = parsePlanFromYaml('name: Smoke\nsteps: []\nvariables: "nope"\n');
    expect(plan.variables).toBeUndefined();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('warns on non-object variable rows', () => {
    const yaml = 'name: Smoke\nsteps: []\nvariables:\n  - "bare"\n';
    const { warnings } = parsePlanFromYaml(yaml);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('warns on variable without string key', () => {
    const yaml = 'name: Smoke\nsteps: []\nvariables:\n  - key: 42\n    value: v\n';
    const { warnings } = parsePlanFromYaml(yaml);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('coerces non-string variable value to empty string', () => {
    const yaml = 'name: Smoke\nsteps: []\nvariables:\n  - key: k\n    value: 42\n';
    const { plan } = parsePlanFromYaml(yaml);
    expect(plan.variables?.[0].value).toBe('');
  });

  it('round-trips through serialize → parse', () => {
    const original = makePlan({
      variables: [{ key: 'k', value: 'v' }],
      envPriorityOrder: [{ kind: 'local', name: 'prod' }],
      stopOnAssertionFailure: true,
    });
    const yaml = serializePlanToYaml(original);
    const { plan } = parsePlanFromYaml(yaml);
    expect(plan.name).toBe(original.name);
    expect(plan.steps).toEqual(original.steps);
    expect(plan.envPriorityOrder).toEqual(original.envPriorityOrder);
    expect(plan.variables).toEqual(original.variables);
    expect(plan.stopOnAssertionFailure).toBe(true);
  });
});
