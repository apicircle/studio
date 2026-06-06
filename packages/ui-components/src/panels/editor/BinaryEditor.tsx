import { useRef } from 'react';
import { FileUp, X } from 'lucide-react';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { FileAssetStatusPill } from '../../primitives/FileAssetStatusPill';
import { FilePickerMenu } from '../../primitives/FilePickerMenu';

interface BinaryEditorProps {
  request: ApiRequest;
}

// Match the FormDataEditor cap so users get consistent guidance across
// body types. GitHub blob limit is 100 MB; we warn above that.
const BINARY_SIZE_WARN_BYTES = 100 * 1024 * 1024;

export function BinaryEditor({ request }: BinaryEditorProps) {
  const attachBinaryFile = useWorkspaceStore((s) => s.attachBinaryFile);
  const detachBinaryFile = useWorkspaceStore((s) => s.detachBinaryFile);
  const setBinaryGlobalFileAsset = useWorkspaceStore((s) => s.setBinaryGlobalFileAsset);
  const globalFiles = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.globalAssets.files ?? {}) : [],
  );
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const attachment = request.body.type === 'binary' ? request.body.attachment : null;
  const oversize = attachment?.size !== undefined && attachment.size > BINARY_SIZE_WARN_BYTES;

  const onPick = (f: File) => {
    if (f.size > BINARY_SIZE_WARN_BYTES) {
      pushToast({
        tone: 'error',
        title: 'File is over 100 MB',
        detail:
          "Sending will likely exhaust IDB quota and may exceed GitHub's blob limit when synced. Consider hosting the file externally and sending a URL.",
      });
    }
    void attachBinaryFile(request.id, f).catch((err) => {
      pushToast({
        tone: 'error',
        title: 'Could not attach file',
        detail: err instanceof Error ? err.message : String(err),
      });
    });
  };

  return (
    <div className="flex flex-col gap-2" aria-label="Binary body">
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        aria-label="Binary body file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />

      {attachment?.slotId && attachment.filename ? (
        <div className="flex items-center gap-3 rounded-sm border border-border bg-card p-3 text-xs">
          <FileUp size={16} className="shrink-0 text-accent" aria-hidden="true" />
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-text-primary" title={attachment.filename}>
                {attachment.filename}
              </span>
              {attachment.globalFileAssetId && (
                <FileAssetStatusPill assetId={attachment.globalFileAssetId} />
              )}
            </span>
            <span className="text-text-dim">
              {formatSize(attachment.size ?? 0)}
              {attachment.mimeType && ` · ${attachment.mimeType}`}
              {attachment.globalFileAssetId && ' · library file'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="shrink-0 rounded-sm border border-border bg-surface px-2 py-1 text-text-muted hover:border-accent hover:text-text-primary"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => void detachBinaryFile(request.id)}
            className="shrink-0 text-text-faint hover:text-danger"
            aria-label="Clear binary file"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        // Single themed picker: "Upload new file..." + library section
        // in one dropdown. Trigger fills the full body-editor width via
        // `fullWidth` so the empty state looks like a deliberate field,
        // not a tiny button drifting in a large card.
        <FilePickerMenu
          libraryFiles={globalFiles}
          onPickLocal={() => fileInput.current?.click()}
          onPickLibrary={(id) => void setBinaryGlobalFileAsset(request.id, id)}
          ariaLabel="Pick file for the binary body"
          triggerLabel="Choose a file to send as binary body"
          size="md"
          fullWidth
        />
      )}

      <p className="text-[0.6875rem] text-text-dim">
        The Content-Type header is set automatically from the file&apos;s MIME type when the request
        is sent. Any user-set Content-Type is stripped to avoid corrupting the body. Files over
        100&nbsp;MB warn - they may exceed GitHub&apos;s blob limit when synced.
      </p>
      {oversize && (
        <p
          role="alert"
          className="rounded-sm border border-warning/40 bg-warning/10 p-2 text-[0.6875rem] text-warning"
        >
          This file is over 100&nbsp;MB. The send may succeed but syncing the workspace to Git will
          likely be refused.
        </p>
      )}
    </div>
  );
}

// `BinaryFileAssetSelect` was retired when the dual-control upload UI
// folded into `FilePickerMenu`. Binding to a library file flows through
// the same menu now — see `setBinaryGlobalFileAsset` on the picker's
// `onPickLibrary`.

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
