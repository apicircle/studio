import {
  applyLinkedEnvironmentOverrides,
  attachmentPath,
  plaintextEnvMap,
  resolveRequestForExecution,
  type AttachmentResolver,
  type ResolvedRequestResult,
  type WorkspaceState,
} from '@apicircle/core';
import { getGitProvider } from '@apicircle/git';
import type {
  EnvPriorityRef,
  Environment,
  LinkedWorkspace,
  Request as ApiRequest,
} from '@apicircle/shared';
import type * as vscode from 'vscode';
import type { VsCodeVaultManager } from '../host/vaultManager';
import { getLinkToken, linkedSecretStorageKey } from '../host/githubAuth';

// =============================================================================
// VS Code send-time resolver.
//
// Wraps the pure core `resolveRequestForExecution` with the host-specific
// pieces — vault decryption for encrypted env-vars, SecretStorage lookup for
// provisioned linked-secret values, plus the `{{linkId}}` context the linked
// projection carries. Returns the resolved request + a list of missing
// placeholders the executor can surface to the user.
// =============================================================================

const ENC_PREFIX = 'enc:v1:';

export interface BuildSendScopeArgs {
  state: WorkspaceState;
  workspaceId: string;
  request: ApiRequest;
  /** Vault for decrypting `enc:v1:` env rows. May be locked — failures are tolerated. */
  vault: VsCodeVaultManager | null;
  /** SecretStorage for provisioned linked-secret values + dedicated tokens. */
  secrets: vscode.SecretStorage;
  /**
   * When the request was opened from a linked-request URI, this is the
   * link id — used to surface that link's provisioned `requiredSecretKeyIds`
   * (each keyed by SecretKeyMeta.label) into the resolver's secrets layer.
   */
  fromLinkId?: string;
  envPriorityOverride?: readonly EnvPriorityRef[];
}

/**
 * Decrypt every `enc:v1:` row in an `Environment.items` map and return a flat
 * plaintext-only structure. Rows the vault can't decrypt (locked / bad
 * ciphertext / missing key) are dropped silently — the resolver reports the
 * placeholder as missing.
 */
async function decryptEnvironments(
  items: Record<string, Environment>,
  vault: VsCodeVaultManager | null,
  workspaceId: string,
): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [envName, env] of Object.entries(items)) {
    const vars: Record<string, string> = {};
    for (const v of env.variables) {
      if (!v.encrypted) {
        vars[v.key] = v.value;
        continue;
      }
      if (!vault || !v.value.startsWith(ENC_PREFIX)) continue;
      try {
        vars[v.key] = await vault.decryptValue(workspaceId, v.value);
      } catch {
        // Locked / corrupt / missing key — the resolver will report the
        // placeholder as missing rather than failing the whole send.
      }
    }
    out[envName] = vars;
  }
  return out;
}

/**
 * Collect every secret value the resolver should know about: linked-secret
 * values keyed by their SecretKeyMeta.label (so `{{LABEL}}` references work),
 * pulled from SecretStorage per link.
 *
 * (Owned-workspace `{{SecretLabel}}` references aren't yet wired — they
 * require a global SecretStorage model that isn't part of this phase.)
 */
async function collectLinkedSecrets(
  state: WorkspaceState,
  secretStorage: vscode.SecretStorage,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const link of Object.values(state.synced.linkedWorkspaces)) {
    const snapshotKeys = state.local.linkedCollections[link.id]?.secretKeys ?? {};
    for (const keyId of link.requiredSecretKeyIds) {
      const meta = snapshotKeys[keyId];
      const value = await secretStorage.get(linkedSecretStorageKey(link.id, keyId));
      if (!value || !meta) continue;
      // First link to declare a label wins — same as the web vault's by-label
      // collapse. Stable enough for the common case (most labels are unique).
      if (out[meta.label] === undefined) out[meta.label] = value;
    }
  }
  return out;
}

export async function buildResolvedRequest(
  args: BuildSendScopeArgs,
): Promise<ResolvedRequestResult> {
  const { state, request, vault, secrets, workspaceId, fromLinkId } = args;

  // Local envs — decrypt encrypted rows up-front.
  const localEnvs = await decryptEnvironments(state.synced.environments.items, vault, workspaceId);

  // Linked envs — apply the consumer's per-row overrides, then decrypt.
  const linkedEnvs: Record<string, Record<string, Record<string, string>>> = {};
  for (const [linkId, snapshot] of Object.entries(state.local.linkedCollections)) {
    const overridden = applyLinkedEnvironmentOverrides(snapshot.environments, linkId, state.synced);
    linkedEnvs[linkId] = await decryptEnvironments(overridden.items, vault, workspaceId);
  }

  // For an owned environment whose every row decrypted to plaintext already
  // (no vault), `plaintextEnvMap` is the simpler path — used by tests.
  void plaintextEnvMap;

  const secretValues = await collectLinkedSecrets(state, secrets);

  return resolveRequestForExecution({
    request,
    synced: state.synced,
    localEnvs,
    linkedEnvs,
    secrets: secretValues,
    globalContext: state.local.globalContext ?? {},
    envPriorityOverride: args.envPriorityOverride,
    // The linked request projection drops fromLinkId here implicitly —
    // its env-vars are reachable via the priority list referring to
    // `{kind:'linked', linkedWorkspaceId: fromLinkId, envName}`. Same machinery,
    // no extra wiring needed.
    ...(fromLinkId ? {} : {}),
  });
}

// ---------------------------------------------------------------------------
// Attachment resolver — fetches linked binary attachments from the source repo
// over GitHub. Owned attachments aren't yet wired into VS Code (their bytes
// would live in IDB, which the extension doesn't have); the resolver returns
// null for any unrecognized slotId, and `buildRequest` surfaces the canonical
// "Attachment X required but not downloaded locally" error.
// ---------------------------------------------------------------------------

export function buildLinkedAttachmentResolver(args: {
  state: WorkspaceState;
  secrets: vscode.SecretStorage;
  fromLinkId: string;
}): AttachmentResolver {
  const link = args.state.synced.linkedWorkspaces[args.fromLinkId];
  if (!link) return () => Promise.resolve(null);
  const ref = link.pinnedVersion ? `v${link.pinnedVersion}` : link.source.branch;
  // Per-resolver cache so repeated reads of the same slot in one send don't
  // re-hit GitHub. The map is GC'd when the resolver goes out of scope.
  const cache = new Map<string, { blob: Blob; filename: string } | null>();
  return async (slotId: string) => {
    if (cache.has(slotId)) return cache.get(slotId) ?? null;
    const result = await fetchLinkedAttachment(link, ref, slotId, args.state, args.secrets);
    cache.set(slotId, result);
    return result;
  };
}

async function fetchLinkedAttachment(
  link: LinkedWorkspace,
  ref: string,
  slotId: string,
  state: WorkspaceState,
  secrets: vscode.SecretStorage,
): Promise<{ blob: Blob; filename: string } | null> {
  // Token: dedicated PAT first, otherwise the built-in GitHub session (if any).
  const token = await getLinkToken(secrets, link);
  const [owner, name] = link.source.repoFullName.split('/', 2);
  const path = attachmentPath(link.sourceWorkspaceId, slotId);
  const client = getGitProvider('github');
  try {
    const file = await client.getBinaryContents(token ?? '', owner, name, path, ref);
    if (!file) return null;
    // Filename: try the cached assets registry; otherwise fall back to slotId.
    const filename =
      state.local.linkedCollections[link.id]?.globalAssets?.files?.[slotId]?.filename ?? slotId;
    // Copy into a fresh ArrayBuffer so the Blob ctor's BlobPart shape is
    // satisfied (Uint8Array<ArrayBufferLike> doesn't narrow to ArrayBuffer in
    // strict mode).
    const buf = new ArrayBuffer(file.bytes.byteLength);
    new Uint8Array(buf).set(file.bytes);
    return { blob: new Blob([buf]), filename };
  } catch {
    return null;
  }
}
