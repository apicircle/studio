import type {
  Assertion,
  AssetGitRef,
  Environment,
  EnvPriorityRef,
  ExecutionPlan,
  Folder,
  GlobalFileAsset,
  MockServer,
  Request as ApiRequest,
  SecretKeyMeta,
  WorkspaceLocal,
  WorkspaceSnapshotTrigger,
  WorkspaceSynced,
} from '@apicircle/shared';
import type { ParsedApicircleFolderExport } from '../import/apicircleFolder';

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
  // Bulk import of a parsed `apicircle.folder/v1` envelope. Wraps every
  // descendant folder/request/dependency in a single atomic mutation so
  // headless writers (CLI / MCP) get the same name-uniquify + dependency
  // dedupe semantics the UI store uses.
  | {
      kind: 'folder.import_apicircle';
      parsed: ParsedApicircleFolderExport;
      parentFolderId: string | null;
    }
  // ----- Environments (synced.environments) ---------------------------------
  | { kind: 'environment.upsert'; environment: Environment }
  | { kind: 'environment.delete'; name: string }
  | { kind: 'environment.setActive'; name: string | null }
  | { kind: 'environment.setPriority'; order: EnvPriorityRef[] }
  // ----- Secret-vault slot metadata (synced.secretKeys) ---------------------
  // Headless writers (MCP environment.import on a v2 envelope, CLI tools)
  // mint slot metadata when the import carries a ciphertext + salt the
  // destination doesn't yet have. The slot's plaintext VALUE is per-device
  // and lives in local.secretIndex — that's intentionally NOT part of this
  // patch, so the missing-slots gate fires on the receiver until the user
  // provides the value. Eagerly merges by id; later upserts overwrite the
  // label + salt (a deliberate choice — a re-import with a different salt
  // signals key rotation).
  | { kind: 'secretKey.upsert'; meta: SecretKeyMeta }
  // ----- Assertions (slot of a Request) -------------------------------------
  | { kind: 'assertion.upsert'; requestId: string; assertion: Assertion }
  | { kind: 'assertion.delete'; requestId: string; assertionId: string }
  // ----- Mock servers (synced.mockServers) ----------------------------------
  | { kind: 'mock.upsert'; mock: MockServer }
  | { kind: 'mock.delete'; id: string }
  // ----- Global file assets (synced.globalAssets.files) ---------------------
  // Asset provenance state machine. `upsertFile` and `removeFile` are the
  // CRUD primitives; the four `mark*` / `cleanup*` / `invalidateRef` kinds
  // are the state-machine transitions driven by push + refresh. See
  // docs/architecture/platform.md for the lifecycle table.
  | { kind: 'globalAsset.upsertFile'; file: GlobalFileAsset }
  | { kind: 'globalAsset.removeFile'; id: string }
  // Push flow: stamp the asset with the working-branch ref after the
  // commit lands. `ref.blobSha` is what makes the cleanup invariant
  // possible — without it we can't compare across refs.
  | { kind: 'globalAsset.markPushed'; id: string; ref: AssetGitRef }
  // Refresh-time promotion: the verification probe found the asset's
  // slot on the base branch (typically `main`), so the PR has merged.
  | { kind: 'globalAsset.markMerged'; id: string; ref: AssetGitRef }
  // Cleanup invariant: both refs resolved to the same blob → the
  // working ref is redundant. Drop it so the base ref is the single
  // source of truth.
  | { kind: 'globalAsset.cleanupWorkingRef'; id: string }
  // 404 on a verification probe → the ref no longer points at a real
  // blob. Drop it so reads stop trying that ref first.
  | { kind: 'globalAsset.invalidateRef'; id: string; which: 'working' | 'base' }
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
