import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  collectAttachmentSlots,
  type AttachmentResolver,
  type WorkspaceState,
} from '@apicircle/core';
import type {
  ExecutionPlan,
  LocalAttachmentCacheEntry,
  RequestBody,
  WorkspaceSynced,
} from '@apicircle/shared';

export interface AttachmentPreparationSummary {
  total: number;
  downloaded: number;
  alreadyPresent: number;
  failed: number;
  cacheDir: string;
  entries: Array<{
    slotId: string;
    filename: string;
    localPath: string;
    source: 'workspace' | 'linked-workspace';
    linkedWorkspaceId?: string;
    requiredBy: Array<{ requestId: string; requestName: string }>;
  }>;
}

export interface PreparedExecutionAttachments {
  state: WorkspaceState;
  resolveAttachment: AttachmentResolver;
  summary: AttachmentPreparationSummary;
}

interface AttachmentRequirement {
  slotId: string;
  sha256?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  source: 'workspace' | 'linked-workspace';
  sourceWorkspaceId: string;
  linkedWorkspaceId?: string;
  repoFullName?: string;
  branch?: string;
  publicRepo?: boolean;
  requiredBy: Array<{ requestId: string; requestName: string }>;
}

const ATTACHMENTS_DIR = 'attachments';

export async function prepareExecutionAttachments(
  workspaceDir: string,
  state: WorkspaceState,
  plan?: ExecutionPlan,
): Promise<PreparedExecutionAttachments> {
  const cacheDir = path.resolve(workspaceDir, ATTACHMENTS_DIR);
  const requirements = collectExecutionAttachmentRequirements(state, plan);
  await fs.mkdir(cacheDir, { recursive: true });

  let downloaded = 0;
  let alreadyPresent = 0;
  let failed = 0;
  const cache: Record<string, LocalAttachmentCacheEntry> = {
    ...(state.local.attachmentCache ?? {}),
  };
  const entries: AttachmentPreparationSummary['entries'] = [];

  for (const requirement of requirements) {
    const localPath = path.join(cacheDir, encodeURIComponent(requirement.slotId));
    const present = await hasExpectedFile(localPath, requirement.sha256);
    if (present) {
      alreadyPresent++;
    } else {
      try {
        const bytes = await downloadAttachment(requirement);
        if (!bytes) {
          throw new Error(
            `Attachment ${attachmentLabel(requirement)} was not found in ${sourceLabel(requirement)}.`,
          );
        }
        if (requirement.sha256 && sha256Hex(bytes) !== requirement.sha256) {
          throw new Error(
            `Attachment ${attachmentLabel(requirement)} failed checksum verification.`,
          );
        }
        await fs.writeFile(localPath, bytes, { mode: 0o600 });
        downloaded++;
      } catch (err) {
        failed++;
        throw new Error(
          `Attachment ${attachmentLabel(requirement)} is required by ${requiredByLabel(
            requirement,
          )} but could not be downloaded from ${sourceLabel(requirement)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    cache[requirement.slotId] = {
      slotId: requirement.slotId,
      filename: requirement.filename ?? requirement.slotId,
      mimeType: requirement.mimeType ?? 'application/octet-stream',
      size: requirement.size ?? (await fileSize(localPath)),
      sha256: requirement.sha256,
      localPath,
      storage: 'filesystem',
      source: requirement.source,
      ...(requirement.linkedWorkspaceId
        ? { linkedWorkspaceId: requirement.linkedWorkspaceId }
        : {}),
      requiredBy: requirement.requiredBy,
      downloadedAt: new Date().toISOString(),
    };
    entries.push({
      slotId: requirement.slotId,
      filename: requirement.filename ?? requirement.slotId,
      localPath,
      source: requirement.source,
      ...(requirement.linkedWorkspaceId
        ? { linkedWorkspaceId: requirement.linkedWorkspaceId }
        : {}),
      requiredBy: requirement.requiredBy,
    });
  }

  const nextState: WorkspaceState = {
    ...state,
    local: {
      ...state.local,
      attachmentCache: cache,
    },
  };

  return {
    state: nextState,
    resolveAttachment: createFileAttachmentResolver(nextState),
    summary: {
      total: requirements.length,
      downloaded,
      alreadyPresent,
      failed,
      cacheDir,
      entries,
    },
  };
}

function createFileAttachmentResolver(state: WorkspaceState): AttachmentResolver {
  return async (slotId) => {
    const meta = state.local.attachmentCache?.[slotId];
    if (!meta) return null;
    const bytes = await fs.readFile(meta.localPath);
    const view = new Uint8Array(bytes);
    const body = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    return {
      blob: new Blob([body], { type: meta.mimeType }),
      filename: meta.filename,
    };
  };
}

function collectExecutionAttachmentRequirements(
  state: WorkspaceState,
  plan?: ExecutionPlan,
): AttachmentRequirement[] {
  const seen = new Map<string, AttachmentRequirement>();
  const localRequestFilter = requestFilterForPlan(plan, null);
  const localCollections = localRequestFilter
    ? {
        ...state.synced.collections,
        requests: Object.fromEntries(
          Object.entries(state.synced.collections.requests).filter(([id]) =>
            localRequestFilter.has(id),
          ),
        ),
      }
    : state.synced.collections;
  const workspaceSlots = collectAttachmentSlots({ ...state.synced, collections: localCollections });
  for (const slot of workspaceSlots) {
    const requiredBy = collectRequiredBy(localCollections.requests, slot.slotId);
    if (requiredBy.length === 0) continue;
    addRequirement(seen, {
      ...slot,
      source: 'workspace',
      sourceWorkspaceId: state.synced.workspaceId,
      repoFullName: state.local.connectedRepo?.fullName ?? undefined,
      branch: state.local.workingBranch?.name ?? undefined,
      publicRepo: state.local.connectedRepo ? !state.local.connectedRepo.isPrivate : false,
      requiredBy,
    });
  }

  for (const [linkedWorkspaceId, snapshot] of Object.entries(state.local.linkedCollections)) {
    const link = state.synced.linkedWorkspaces[linkedWorkspaceId];
    if (!link) continue;
    const linkedRequestFilter = requestFilterForPlan(plan, linkedWorkspaceId);
    if (plan && linkedRequestFilter && linkedRequestFilter.size === 0) continue;
    const linkedCollections = linkedRequestFilter
      ? {
          ...snapshot.collections,
          requests: Object.fromEntries(
            Object.entries(snapshot.collections.requests).filter(([id]) =>
              linkedRequestFilter.has(id),
            ),
          ),
        }
      : snapshot.collections;
    const linkedSynced: WorkspaceSynced = {
      ...state.synced,
      collections: linkedCollections,
      environments: snapshot.environments,
      globalAssets: snapshot.globalAssets ?? state.synced.globalAssets,
    };
    for (const slot of collectAttachmentSlots(linkedSynced)) {
      const requiredBy = collectRequiredBy(linkedCollections.requests, slot.slotId);
      if (requiredBy.length === 0) continue;
      addRequirement(seen, {
        ...slot,
        source: 'linked-workspace',
        sourceWorkspaceId: link.sourceWorkspaceId,
        linkedWorkspaceId,
        repoFullName: link.source.repoFullName,
        branch: link.source.branch,
        publicRepo: link.kind === 'public',
        requiredBy,
      });
    }
  }

  return [...seen.values()];
}

function requestFilterForPlan(
  plan: ExecutionPlan | undefined,
  linkedWorkspaceId: string | null,
): Set<string> | null {
  if (!plan) return null;
  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (step.enabled === false) continue;
    if ((step.linkedWorkspaceId ?? null) === linkedWorkspaceId) ids.add(step.requestId);
  }
  return ids;
}

function addRequirement(
  seen: Map<string, AttachmentRequirement>,
  requirement: AttachmentRequirement,
): void {
  const existing = seen.get(requirement.slotId);
  if (!existing) {
    seen.set(requirement.slotId, requirement);
    return;
  }
  for (const usage of requirement.requiredBy) {
    if (!existing.requiredBy.some((item) => item.requestId === usage.requestId)) {
      existing.requiredBy.push(usage);
    }
  }
}

function collectRequiredBy(
  requests: WorkspaceSynced['collections']['requests'],
  slotId: string,
): Array<{ requestId: string; requestName: string }> {
  const requiredBy: Array<{ requestId: string; requestName: string }> = [];
  for (const request of Object.values(requests)) {
    if (bodyReferencesSlot(request.body, slotId)) {
      requiredBy.push({ requestId: request.id, requestName: request.name });
    }
  }
  return requiredBy;
}

function bodyReferencesSlot(body: RequestBody, slotId: string): boolean {
  if (body.type === 'binary') return body.attachment?.slotId === slotId;
  if (body.type !== 'form-data') return false;
  return (body.formRows ?? []).some((row) => row.kind === 'file' && row.slotId === slotId);
}

async function hasExpectedFile(localPath: string, sha256?: string): Promise<boolean> {
  try {
    const bytes = await fs.readFile(localPath);
    if (!sha256) return true;
    return sha256Hex(bytes) === sha256;
  } catch {
    return false;
  }
}

async function fileSize(localPath: string): Promise<number> {
  try {
    return (await fs.stat(localPath)).size;
  } catch {
    return 0;
  }
}

async function downloadAttachment(requirement: AttachmentRequirement): Promise<Uint8Array | null> {
  if (!requirement.repoFullName || !requirement.branch) return null;
  const [owner, repo] = requirement.repoFullName.split('/', 2);
  if (!owner || !repo) return null;
  const token = resolveGitHubToken(requirement);
  if (!token && !requirement.publicRepo) {
    throw new Error(
      'private linked attachments need a GitHub token (set APICIRCLE_GITHUB_TOKEN or GITHUB_TOKEN)',
    );
  }

  const apiPath = [
    '.apicircle',
    `workspace-${requirement.sourceWorkspaceId}`,
    'attachments',
    requirement.slotId,
  ]
    .map(encodeURIComponent)
    .join('/');
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/contents/${apiPath}?ref=${encodeURIComponent(requirement.branch)}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'apicircle-cli',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers, cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { type?: string; content?: string; encoding?: string };
  if (json.type !== 'file' || typeof json.content !== 'string') {
    throw new Error('GitHub response was not a file');
  }
  if (json.encoding !== 'base64') {
    throw new Error(`GitHub response used unsupported encoding ${json.encoding ?? '(missing)'}`);
  }
  return new Uint8Array(Buffer.from(json.content.replace(/\n/g, ''), 'base64'));
}

function resolveGitHubToken(requirement: AttachmentRequirement): string {
  if (requirement.source === 'linked-workspace') {
    return (
      process.env.APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED ??
      process.env.APICIRCLE_GITHUB_TOKEN ??
      process.env.GITHUB_TOKEN ??
      process.env.APICIRCLE_E2E_GITHUB_PAT ??
      process.env.APICIRCLE_E2E_BOT_PAT ??
      ''
    );
  }
  return (
    process.env.APICIRCLE_GITHUB_TOKEN ??
    process.env.GITHUB_TOKEN ??
    process.env.APICIRCLE_E2E_GITHUB_PAT ??
    process.env.APICIRCLE_E2E_BOT_PAT ??
    ''
  );
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function attachmentLabel(requirement: AttachmentRequirement): string {
  return `${requirement.filename ?? requirement.slotId} (${requirement.slotId})`;
}

function sourceLabel(requirement: AttachmentRequirement): string {
  const repo = requirement.repoFullName ?? 'local workspace';
  const branch = requirement.branch ? `@${requirement.branch}` : '';
  return `${repo}${branch}`;
}

function requiredByLabel(requirement: AttachmentRequirement): string {
  return requirement.requiredBy.map((item) => item.requestName).join(', ') || 'a request';
}
