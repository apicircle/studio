import * as YAML from 'yaml';
import type { ExecutionPlan, EnvPriorityRef } from '@apicircle/shared';

// =============================================================================
// Plan YAML projection.
//
// Round-trip between the canonical ExecutionPlan shape inside
// workspace.local.json and the human-friendly YAML the user edits.
//
// Layout:
//   name: Smoke test
//   stopOnAssertionFailure: true
//   steps:
//     - requestId: req-abc
//       enabled: true
//   variables:
//     - key: api_base
//       value: https://api.example.com
//   envPriorityOrder:
//     - local: prod
//     - linked:
//         workspaceId: ws-123
//         envName: shared
// =============================================================================

interface PlanYamlOutput {
  name: string;
  stopOnAssertionFailure?: boolean;
  steps: Array<{
    requestId: string;
    enabled?: boolean;
    linkedWorkspaceId?: string;
  }>;
  variables?: Array<{ key: string; value: string }>;
  envPriorityOrder?: Array<
    { local: string } | { linked: { workspaceId: string; envName: string } }
  >;
}

const HEADER_COMMENT = `# API Circle Execution Plan — edit fields below and save to commit.
# Plans chain requests with assertions to validate end-to-end flows.
# Use the ▶ Run with assertions / ▶ Run CodeLenses above the 'name:' line
# (or right-click the plan in the Execution view) to launch it. The
# ✚ Add step lens on 'steps:' and the per-step open / enable-disable /
# change / remove lenses edit the steps without hand-writing request ids.
`;

/**
 * Resolve a human-readable label for a plan step — `<name> · <METHOD> · <folder
 * path>` — so the YAML annotates each `requestId` row with what it actually is
 * (the raw id alone is useless to a reader). The FS provider supplies this from
 * the workspace; when omitted (tests / no resolver) the rows carry no comment.
 */
export type ResolveStepLabel = (step: {
  requestId: string;
  linkedWorkspaceId?: string;
}) => string | undefined;

export function serializePlanToYaml(
  plan: ExecutionPlan,
  resolveStepLabel?: ResolveStepLabel,
): string {
  const out: PlanYamlOutput = {
    name: plan.name,
    steps: plan.steps.map((s) => {
      const row: PlanYamlOutput['steps'][number] = { requestId: s.requestId };
      if (s.enabled === false) row.enabled = false;
      if (s.linkedWorkspaceId) row.linkedWorkspaceId = s.linkedWorkspaceId;
      return row;
    }),
  };
  if (plan.stopOnAssertionFailure === true) out.stopOnAssertionFailure = true;
  if (plan.variables && plan.variables.length > 0) {
    out.variables = plan.variables.map((v) => ({ key: v.key, value: v.value }));
  }
  if (plan.envPriorityOrder.length > 0) {
    out.envPriorityOrder = plan.envPriorityOrder.map(serializeEnvRef);
  }
  const doc = new YAML.Document(out);
  doc.commentBefore = HEADER_COMMENT.replace(/^# /gm, ' ').trimEnd();

  // Annotate every step row with its resolved `<name> · <METHOD> · <folder>` so
  // the reader sees what each step is instead of an opaque requestId. Comments
  // are dropped by parsePlanFromYaml, so this never affects the round-trip.
  if (resolveStepLabel) {
    const stepsNode = doc.get('steps');
    if (YAML.isSeq(stepsNode)) {
      stepsNode.items.forEach((item, i) => {
        const step = plan.steps[i];
        if (!step || !YAML.isMap(item)) return;
        const label = resolveStepLabel(step);
        if (label) item.commentBefore = ` ${label}`;
      });
    }
  }
  return doc.toString({ lineWidth: 0 });
}

function serializeEnvRef(
  ref: EnvPriorityRef,
): { local: string } | { linked: { workspaceId: string; envName: string } } {
  if (ref.kind === 'local') return { local: ref.name };
  return { linked: { workspaceId: ref.linkedWorkspaceId, envName: ref.envName } };
}

export interface ParsedPlanYaml {
  /** ExecutionPlan minus id/createdAt — caller injects those when writing. */
  plan: Omit<ExecutionPlan, 'id' | 'createdAt' | 'updatedAt'>;
  warnings: string[];
}

export function parsePlanFromYaml(text: string): ParsedPlanYaml {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (e) {
    throw new PlanYamlParseError(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PlanYamlParseError('Document root must be a mapping with `name` and `steps`.');
  }
  const obj = parsed as Record<string, unknown>;
  const warnings: string[] = [];
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    throw new PlanYamlParseError('Plan `name` is required and must be a non-empty string.');
  }
  const steps = normalizeSteps(obj.steps, warnings);
  const envPriorityOrder = normalizeEnvOrder(obj.envPriorityOrder, warnings);
  const variables = normalizeVariables(obj.variables, warnings);
  const stopOnAssertionFailure = obj.stopOnAssertionFailure === true;
  return {
    plan: {
      name: obj.name,
      steps,
      envPriorityOrder,
      variables,
      stopOnAssertionFailure,
    },
    warnings,
  };
}

function normalizeSteps(value: unknown, warnings: string[]): ExecutionPlan['steps'] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push('`steps` should be a list of {requestId, enabled?, linkedWorkspaceId?}');
    return [];
  }
  return value
    .map((row, i): ExecutionPlan['steps'][number] | null => {
      if (typeof row !== 'object' || row === null) {
        warnings.push(`steps[${i}] is not an object`);
        return null;
      }
      const r = row as Record<string, unknown>;
      if (typeof r.requestId !== 'string') {
        warnings.push(`steps[${i}].requestId must be a string`);
        return null;
      }
      const step: ExecutionPlan['steps'][number] = { requestId: r.requestId };
      if (r.enabled === false) step.enabled = false;
      else step.enabled = true;
      if (typeof r.linkedWorkspaceId === 'string' && r.linkedWorkspaceId.length > 0) {
        step.linkedWorkspaceId = r.linkedWorkspaceId;
      }
      return step;
    })
    .filter((s): s is ExecutionPlan['steps'][number] => s !== null);
}

function normalizeEnvOrder(value: unknown, warnings: string[]): EnvPriorityRef[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push('`envPriorityOrder` should be a list of refs');
    return [];
  }
  return value
    .map((row, i): EnvPriorityRef | null => {
      if (typeof row !== 'object' || row === null) {
        warnings.push(`envPriorityOrder[${i}] is not an object`);
        return null;
      }
      const r = row as Record<string, unknown>;
      if (typeof r.local === 'string' && r.local.length > 0) {
        return { kind: 'local', name: r.local };
      }
      if (r.linked && typeof r.linked === 'object') {
        const l = r.linked as Record<string, unknown>;
        if (typeof l.workspaceId === 'string' && typeof l.envName === 'string') {
          return { kind: 'linked', linkedWorkspaceId: l.workspaceId, envName: l.envName };
        }
      }
      warnings.push(
        `envPriorityOrder[${i}] must be {local: string} or {linked: {workspaceId, envName}}`,
      );
      return null;
    })
    .filter((r): r is EnvPriorityRef => r !== null);
}

function normalizeVariables(
  value: unknown,
  warnings: string[],
): Array<{ key: string; value: string }> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    warnings.push('`variables` should be a list of {key, value}');
    return undefined;
  }
  const out = value
    .map((row, i): { key: string; value: string } | null => {
      if (typeof row !== 'object' || row === null) {
        warnings.push(`variables[${i}] is not an object`);
        return null;
      }
      const r = row as Record<string, unknown>;
      if (typeof r.key !== 'string') {
        warnings.push(`variables[${i}].key must be a string`);
        return null;
      }
      return { key: r.key, value: typeof r.value === 'string' ? r.value : '' };
    })
    .filter((v): v is { key: string; value: string } => v !== null);
  return out.length > 0 ? out : undefined;
}

export class PlanYamlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanYamlParseError';
  }
}
