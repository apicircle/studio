import { useRef } from 'react';
import { FileUp, X } from 'lucide-react';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface BinaryEditorProps {
  request: ApiRequest;
}

export function BinaryEditor({ request }: BinaryEditorProps) {
  const attachBinaryFile = useWorkspaceStore((s) => s.attachBinaryFile);
  const detachBinaryFile = useWorkspaceStore((s) => s.detachBinaryFile);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const attachment = request.body.type === 'binary' ? request.body.attachment : null;

  return (
    <div className="flex flex-col gap-2" aria-label="Binary body">
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        aria-label="Binary body file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void attachBinaryFile(request.id, f);
          e.target.value = '';
        }}
      />

      {attachment?.slotId && attachment.filename ? (
        <div className="flex items-center gap-3 rounded-sm border border-border bg-card p-3 text-xs">
          <FileUp size={16} className="shrink-0 text-accent" aria-hidden="true" />
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="truncate font-medium text-text-primary" title={attachment.filename}>
              {attachment.filename}
            </span>
            <span className="text-text-dim">
              {formatSize(attachment.size ?? 0)}
              {attachment.mimeType && ` · ${attachment.mimeType}`}
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
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center justify-center gap-2 rounded-sm border border-dashed border-border bg-card px-4 py-6 text-sm text-text-muted transition-colors hover:border-accent hover:text-text-primary"
        >
          <FileUp size={16} />
          Choose a file to send as binary body
        </button>
      )}

      <p className="text-[0.6875rem] text-text-dim">
        The Content-Type header is set automatically from the file&apos;s MIME type when the request
        is sent. Any user-set Content-Type is stripped to avoid corrupting the body.
      </p>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
