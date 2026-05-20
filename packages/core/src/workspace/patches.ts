import type {
  Assertion,
  Environment,
  EnvPriorityRef,
  ExecutionPlan,
  Folder,
  MockServer,
  Request as ApiRequest,
  WorkspaceLocal,
  WorkspaceSnapshotTrigger,
  WorkspaceSynced,
} from '@apicircle/shared';

// =============================================================================
// WorkspacePatch — discriminated union of every mutation kind.
//
// A single value of this type completely describes a write to the workspace.
// `applyMutation(state, patch)` is the one place where these are dispatched;
// the UI store, MCP tool handlers, and CLI commands all funnel through it so
// semantics never drift between front-ends.
//
// Patches that target the synced document (`request.*`, `folder.*`,
// `environment.*`, `assertion.*`, `mock.*`) bump `synced.meta.updatedAt`.
// Patches that target the local document (`plan.*`) leave synced untouched.
// =============================================================================

export type WorkspacePatch =
  // ----- Requests (synced.collections.requests + tree) ----------------------
  | { kind: 'request.create'; request: ApiRequest }
  | { kind: 'request.update'; id: string; patch: Partial<Omit<ApiRequest, 'id' | 'createdAt'>> }
  | { kind: 'request.delete'; id: string }
  // ----- Folders (synced.collections.folders + tree) ------------------------
  | { kind: 'folder.create'; folder: Folder }
  | { kind: 'folder.delete'; id: string }
  | { kind: 'folder.move'; id: string; newParentId: string | null }
  // ----- Environments (synced.environments) ---------------------------------
  | { kind: 'environment.upsert'; environment: Environment }
  | { kind: 'environment.delete'; name: string }
  | { kind: 'environment.setActive'; name: string | null }
  | { kind: 'environment.setPriority'; order: EnvPriorityRef[] }
  // ----- Assertions (slot of a Request) -------------------------------------
  | { kind: 'assertion.upsert'; requestId: string; assertion: Assertion }
  | { kind: 'assertion.delete'; requestId: string; assertionId: string }
  // ----- Mock servers (synced.mockServers) ----------------------------------
  | { kind: 'mock.upsert'; mock: MockServer }
  | { kind: 'mock.delete'; id: string }
  // ----- Execution plans (local.executionPlans) -----------------------------
  | { kind: 'plan.upsert'; plan: ExecutionPlan }
  | { kind: 'plan.delete'; id: string }
  // ----- History (local.history.requestRuns + planRuns) ---------------------
  | { kind: 'history.delete_run'; runId: string }
  | { kind: 'history.delete_plan_run'; planRunId: string }
  | { kind: 'history.purge'; olderThanMs: number }
  // ----- Workspace snapshots (local.snapshots) ------------------------------
  | { kind: 'snapshot.capture'; trigger: WorkspaceSnapshotTrigger; note?: string; id?: string }
  | { kind: 'snapshot.delete'; id: string }
  | { kind: 'snapshot.restore'; id: string }
  | { kind: 'snapshot.set_max_bytes'; maxBytes: number };

export type WorkspacePatchKind = WorkspacePatch['kind'];

// Convenience alias for callers that want to hold a paired view of the
// workspace before passing it through `applyMutation`.
export interface WorkspaceState {
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
}
