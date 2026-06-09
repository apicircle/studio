import * as vscode from 'vscode';

// =============================================================================
// Phase 9 — Plan Notebook serializer.
//
// Maps `ExecutionPlan` ↔ `NotebookData` so VS Code's native notebook UI can
// drive the existing plan engine. One cell per step; the cell's source is a
// human-readable summary of the step (request name + method + URL) plus a
// `# apicircle-plan-step` directive line at the top that the deserializer
// reads back into structured metadata.
//
// Persistence shape — `.apicircle-plan.json`:
//
//   {
//     "schemaVersion": 1,
//     "planId": "<id>",
//     "workspaceId": "<id>",
//     "steps": [{ "requestId": "<id>", "linkedWorkspaceId"?: "<id>", "enabled"?: bool }],
//     "envPriorityOrder": EnvPriorityRef[],
//     "variables"?: [{key,value}],
//     "stopOnAssertionFailure"?: bool
//   }
//
// We keep the serializer round-trip lossless against the canonical Plan shape:
// open → edit → save round-trips a plan without losing fields the notebook UI
// doesn't render. Steps map 1:1; envPriorityOrder + variables + flags ride in
// the notebook metadata so they're preserved.
//
// The notebook content type is `apicircle-plan` (registered in package.json's
// `contributes.notebooks`). Files match `**/*.apicircle-plan.json`.
// =============================================================================

export const PLAN_NOTEBOOK_TYPE = 'apicircle-plan';
export const PLAN_NOTEBOOK_SCHEMA_VERSION = 1;

/** Subset of ExecutionPlan we persist into the notebook file. Mirrors the
 *  shape in `packages/shared/src/types.ts` ExecutionPlan; we keep the import
 *  loose (typeof-shaped) so the notebook layer doesn't import from
 *  `@apicircle/shared` directly — the bridge already knows that type. */
export interface PlanNotebookStep {
  requestId: string;
  linkedWorkspaceId?: string;
  enabled?: boolean;
}

export interface PlanNotebookPayload {
  schemaVersion: number;
  planId: string;
  workspaceId: string;
  steps: PlanNotebookStep[];
  envPriorityOrder: unknown[];
  variables?: Array<{ key: string; value: string }>;
  stopOnAssertionFailure?: boolean;
}

/** Per-cell metadata that survives the notebook → file → notebook round-trip.
 *  Stored on `NotebookCellData.metadata`. */
export interface PlanCellMetadata {
  requestId: string;
  linkedWorkspaceId?: string;
  /** `enabled === false` only — undefined/true persist as just absence. */
  enabled?: boolean;
}

/** Notebook-level metadata that rides on `NotebookData.metadata`. */
export interface PlanNotebookMetadata {
  planId: string;
  workspaceId: string;
  envPriorityOrder: unknown[];
  variables?: Array<{ key: string; value: string }>;
  stopOnAssertionFailure?: boolean;
}

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

/**
 * Format the human-visible source for a step cell. We mark the directive
 * line so future editors can disambiguate "user-typed YAML/Markdown" from
 * "metadata we own."
 */
function renderCellSource(
  step: PlanNotebookStep,
  requestSummary: { name: string; method: string; url: string } | null,
): string {
  const flags: string[] = [];
  if (step.enabled === false) flags.push('disabled');
  if (step.linkedWorkspaceId) flags.push(`linked=${step.linkedWorkspaceId}`);
  const flagsSuffix = flags.length ? ` # [${flags.join(', ')}]` : '';
  const directive = `# apicircle-plan-step: ${step.requestId}${flagsSuffix}`;
  if (requestSummary) {
    return `${directive}\n${requestSummary.method} ${requestSummary.url}\n# ${requestSummary.name}`;
  }
  // Unknown request — show the bare directive so the user can spot the
  // missing reference instead of an empty cell.
  return `${directive}\n# (request not found in workspace — was it deleted?)`;
}

/**
 * Parse a step directive line back into structured metadata. Tolerant of
 * extra whitespace, missing flags, and user edits that don't break the
 * `apicircle-plan-step:` token.
 */
function parseDirective(source: string): {
  requestId: string;
  linkedWorkspaceId?: string;
  enabled?: boolean;
} | null {
  const m = /^#\s*apicircle-plan-step:\s*([^\s#]+)\s*(?:#\s*\[([^\]]*)\])?/.exec(source);
  if (!m) return null;
  const requestId = m[1];
  const flagBlob = m[2];
  let linkedWorkspaceId: string | undefined;
  let enabled: boolean | undefined;
  if (flagBlob) {
    for (const raw of flagBlob.split(',')) {
      const f = raw.trim();
      if (f === 'disabled') enabled = false;
      else if (f.startsWith('linked=')) linkedWorkspaceId = f.slice('linked='.length);
    }
  }
  return { requestId, linkedWorkspaceId, enabled };
}

/**
 * Serializer implementation. Called by VS Code on file open + save.
 *
 * - `deserializeNotebook`: bytes → `NotebookData`. Reads the persisted
 *   `PlanNotebookPayload` JSON, derives one cell per step, builds the
 *   notebook-level metadata block.
 * - `serializeNotebook`: `NotebookData` → bytes. Pulls structured metadata
 *   off each cell + the notebook itself, builds the canonical payload,
 *   pretty-prints JSON.
 *
 * The `getRequestSummary` callback is injected so the serializer doesn't
 * have to depend on the workspace bridge directly — the wiring layer
 * passes a lookup that reads from the active workspace's requests map.
 * Missing requests render with a "not found" comment rather than crashing.
 */
export class PlanNotebookSerializer implements vscode.NotebookSerializer {
  constructor(
    private readonly getRequestSummary: (
      requestId: string,
    ) => { name: string; method: string; url: string } | null,
  ) {}

  deserializeNotebook(content: Uint8Array): vscode.NotebookData {
    const text = DECODER.decode(content).trim();
    // Empty file → empty notebook (let the user start adding cells).
    if (text.length === 0) {
      const empty = new vscode.NotebookData([]);
      empty.metadata = {} satisfies Record<string, never>;
      return empty;
    }
    let parsed: PlanNotebookPayload;
    try {
      parsed = JSON.parse(text) as PlanNotebookPayload;
    } catch (err) {
      // Don't throw — surface the parse error in a single error cell so
      // the user can see what's wrong rather than VS Code's generic
      // "couldn't open notebook" toast.
      const msg = err instanceof Error ? err.message : String(err);
      const errorCell = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Markup,
        `# Plan Notebook parse error\n\n\`\`\`\n${msg}\n\`\`\`\n\n_The underlying \`.apicircle-plan.json\` file is malformed. Open it in raw text mode to repair._`,
        'markdown',
      );
      return new vscode.NotebookData([errorCell]);
    }
    const cells = (parsed.steps ?? []).map((step) => {
      const summary = this.getRequestSummary(step.requestId);
      const cell = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        renderCellSource(step, summary),
        'apicircle-plan-step',
      );
      const md: PlanCellMetadata = { requestId: step.requestId };
      if (step.linkedWorkspaceId) md.linkedWorkspaceId = step.linkedWorkspaceId;
      if (step.enabled === false) md.enabled = false;
      cell.metadata = { ...md };
      return cell;
    });
    const data = new vscode.NotebookData(cells);
    const notebookMd: PlanNotebookMetadata = {
      planId: parsed.planId,
      workspaceId: parsed.workspaceId,
      envPriorityOrder: parsed.envPriorityOrder ?? [],
    };
    if (parsed.variables && parsed.variables.length > 0) {
      notebookMd.variables = parsed.variables;
    }
    if (parsed.stopOnAssertionFailure) {
      notebookMd.stopOnAssertionFailure = parsed.stopOnAssertionFailure;
    }
    data.metadata = { ...notebookMd };
    return data;
  }

  serializeNotebook(data: vscode.NotebookData): Uint8Array {
    const md = (data.metadata ?? {}) as Partial<PlanNotebookMetadata>;
    const steps: PlanNotebookStep[] = [];
    for (const cell of data.cells) {
      if (cell.kind !== vscode.NotebookCellKind.Code) continue;
      const cellMd = (cell.metadata ?? {}) as Partial<PlanCellMetadata>;
      // Prefer structured metadata; fall back to parsing the source's
      // directive line. This means a user who hand-edits the cell text
      // to change the requestId still sees the change persisted.
      const directive = parseDirective(cell.value);
      const requestId = directive?.requestId ?? cellMd.requestId;
      if (!requestId) continue; // skip cells without a referenced request
      const step: PlanNotebookStep = { requestId };
      const linkedWorkspaceId = directive?.linkedWorkspaceId ?? cellMd.linkedWorkspaceId;
      if (linkedWorkspaceId) step.linkedWorkspaceId = linkedWorkspaceId;
      const enabled = directive?.enabled ?? cellMd.enabled;
      if (enabled === false) step.enabled = false;
      steps.push(step);
    }
    const payload: PlanNotebookPayload = {
      schemaVersion: PLAN_NOTEBOOK_SCHEMA_VERSION,
      planId: md.planId ?? '',
      workspaceId: md.workspaceId ?? '',
      steps,
      envPriorityOrder: md.envPriorityOrder ?? [],
    };
    if (md.variables && md.variables.length > 0) {
      payload.variables = md.variables;
    }
    if (md.stopOnAssertionFailure) {
      payload.stopOnAssertionFailure = md.stopOnAssertionFailure;
    }
    return ENCODER.encode(JSON.stringify(payload, null, 2) + '\n');
  }
}

/** Standalone helper — extracts the request directive from a cell's text.
 *  Re-exported so the controller can match cells against requests without
 *  re-parsing the file every time. */
export function parseStepCellDirective(source: string): {
  requestId: string;
  linkedWorkspaceId?: string;
  enabled?: boolean;
} | null {
  return parseDirective(source);
}

/** Build a `PlanNotebookPayload` from a known plan + workspace pair. Used
 *  by the "Open Plan as Notebook" command to seed a `.apicircle-plan.json`
 *  file from the existing in-store plan. */
export function buildPayloadFromPlan(
  workspaceId: string,
  plan: {
    id: string;
    steps: ReadonlyArray<{ requestId: string; linkedWorkspaceId?: string; enabled?: boolean }>;
    envPriorityOrder: unknown[];
    variables?: Array<{ key: string; value: string }>;
    stopOnAssertionFailure?: boolean;
  },
): PlanNotebookPayload {
  const payload: PlanNotebookPayload = {
    schemaVersion: PLAN_NOTEBOOK_SCHEMA_VERSION,
    planId: plan.id,
    workspaceId,
    steps: plan.steps.map((s) => {
      const out: PlanNotebookStep = { requestId: s.requestId };
      if (s.linkedWorkspaceId) out.linkedWorkspaceId = s.linkedWorkspaceId;
      if (s.enabled === false) out.enabled = false;
      return out;
    }),
    envPriorityOrder: plan.envPriorityOrder,
  };
  if (plan.variables && plan.variables.length > 0) {
    payload.variables = plan.variables;
  }
  if (plan.stopOnAssertionFailure) {
    payload.stopOnAssertionFailure = plan.stopOnAssertionFailure;
  }
  return payload;
}
