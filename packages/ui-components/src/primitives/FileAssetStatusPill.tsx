import { CloudOff, CloudUpload, GitBranch, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { GlobalFileAsset } from '@apicircle/shared';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from './cn';

// Small badge that renders the current location-state of a Global File
// Asset's bytes. Derived from three slices:
//
//   1. `synced.globalAssets.files[id]` — the asset's ref provenance
//      (workingBranchRef + baseBranchRef).
//   2. `local.pendingFileUploads[id]` — bytes in IDB but not yet
//      pushed to any Git ref.
//   3. `local.assetUsageIndex[id]` — denormalised reference count for
//      the hover tooltip.
//
// State machine (see docs/architecture/platform.md):
//
//   - 'uploading'   — pending upload buffer set, no ref yet
//   - 'workingOnly' — workingBranchRef set, baseBranchRef null
//   - 'merged'      — both refs set, blob shas differ (pre-cleanup)
//   - 'baseOnly'    — baseBranchRef only (single source of truth)
//   - 'missing'     — both refs null + no pending bytes
//   - 'diverged'    — both refs set with mismatched blob shas

export type FileAssetState =
  | 'uploading'
  | 'workingOnly'
  | 'merged'
  | 'baseOnly'
  | 'missing'
  | 'diverged';

export function deriveFileAssetState(
  asset: Pick<GlobalFileAsset, 'workingBranchRef' | 'baseBranchRef'> | null | undefined,
  hasPendingUpload: boolean,
): FileAssetState {
  if (!asset) return 'missing';
  const working = asset.workingBranchRef ?? null;
  const base = asset.baseBranchRef ?? null;
  if (working && base) {
    if (working.blobSha && base.blobSha && working.blobSha !== base.blobSha) {
      return 'diverged';
    }
    return 'merged';
  }
  if (working && !base) return 'workingOnly';
  if (!working && base) return 'baseOnly';
  if (hasPendingUpload) return 'uploading';
  return 'missing';
}

interface PillStyle {
  label: string;
  border: string;
  bg: string;
  fg: string;
  icon: typeof CloudUpload;
}

const styles: Record<FileAssetState, PillStyle> = {
  uploading: {
    label: 'Uploaded locally',
    border: 'border-warning/40',
    bg: 'bg-warning/10',
    fg: 'text-warning',
    icon: CloudUpload,
  },
  workingOnly: {
    label: 'On working branch',
    border: 'border-accent/40',
    bg: 'bg-accent/10',
    fg: 'text-accent',
    icon: GitBranch,
  },
  merged: {
    label: 'Merged to base',
    border: 'border-success/40',
    bg: 'bg-success/10',
    fg: 'text-success',
    icon: ShieldCheck,
  },
  baseOnly: {
    label: 'On main',
    border: 'border-success/40',
    bg: 'bg-success/10',
    fg: 'text-success',
    icon: ShieldCheck,
  },
  missing: {
    label: 'Missing — re-upload',
    border: 'border-danger/40',
    bg: 'bg-danger/10',
    fg: 'text-danger',
    icon: CloudOff,
  },
  diverged: {
    label: 'Diverged',
    border: 'border-warning/40',
    bg: 'bg-warning/10',
    fg: 'text-warning',
    icon: AlertTriangle,
  },
};

export interface FileAssetStatusPillProps {
  assetId: string;
  /** Optional className applied to the outer span. */
  className?: string;
  /** When true, drops the label text and shows just the icon + tooltip. */
  iconOnly?: boolean;
}

export function FileAssetStatusPill({
  assetId,
  className,
  iconOnly = false,
}: FileAssetStatusPillProps): JSX.Element | null {
  const asset = useWorkspaceStore((s) => s.synced?.globalAssets.files?.[assetId] ?? null);
  const hasPending = useWorkspaceStore((s) => Boolean(s.local?.pendingFileUploads?.[assetId]));
  const usage = useWorkspaceStore((s) => s.local?.assetUsageIndex?.[assetId] ?? null);

  if (!asset && !hasPending) return null;

  const state = deriveFileAssetState(asset, hasPending);
  const style = styles[state];
  const Icon = style.icon;

  const verboseLines: string[] = [style.label];
  if (state === 'workingOnly' && asset?.workingBranchRef) {
    verboseLines.push(`branch: ${asset.workingBranchRef.branchName}`);
    if (asset.workingBranchRef.verifiedAt) {
      verboseLines.push(`verified: ${asset.workingBranchRef.verifiedAt}`);
    }
  } else if (state === 'baseOnly' && asset?.baseBranchRef) {
    verboseLines.push(`branch: ${asset.baseBranchRef.branchName}`);
  } else if (state === 'merged' && asset?.workingBranchRef && asset?.baseBranchRef) {
    verboseLines.push(`${asset.workingBranchRef.branchName} + ${asset.baseBranchRef.branchName}`);
  } else if (state === 'diverged') {
    verboseLines.push('Same path resolves to different blobs on the two refs');
  } else if (state === 'missing') {
    verboseLines.push('No working or base ref resolves; re-upload to restore.');
  } else if (state === 'uploading') {
    verboseLines.push('Bytes are in local IDB; next push uploads them.');
  }
  if (usage) {
    verboseLines.push(`used in ${usage.total} place${usage.total === 1 ? '' : 's'}`);
  }
  const title = verboseLines.join('\n');

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[0.625rem]',
        style.border,
        style.bg,
        style.fg,
        className,
      )}
      title={title}
      data-asset-state={state}
      role="status"
      aria-label={`File asset status: ${style.label}`}
    >
      <Icon size={10} aria-hidden="true" />
      {!iconOnly && <span className="truncate">{style.label}</span>}
    </span>
  );
}
