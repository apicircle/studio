import { useEffect, useMemo, useState } from 'react';
import { Download, FileArchive, Loader2, X } from 'lucide-react';
import { formatBytes } from '@apicircle/shared';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Modal } from '../primitives/Modal';

export function AttachmentDownloadPromptModal() {
  const prompt = useWorkspaceStore((s) => s.attachmentDownloadPrompt);
  const resolvePrompt = useWorkspaceStore((s) => s.resolveAttachmentDownloadPrompt);
  const syncAttachments = useWorkspaceStore((s) => s.syncAttachments);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDownloading(false);
    setError(null);
  }, [prompt?.id]);

  const totalSize = useMemo(() => {
    if (!prompt) return 0;
    return prompt.items.reduce((sum, item) => sum + (item.size ?? 0), 0);
  }, [prompt]);

  if (!prompt) return null;

  const close = () => {
    if (!downloading) resolvePrompt(false);
  };

  const downloadAndContinue = async () => {
    setDownloading(true);
    setError(null);
    let closed = false;
    try {
      const result = await syncAttachments();
      if (result.failed > 0) {
        setError(
          `${result.failed} file${result.failed === 1 ? '' : 's'} could not be downloaded or failed checksum verification. Check the linked workspace session, GitHub permissions, and source file integrity, then try again.`,
        );
        return;
      }
      pushToast({
        tone: 'success',
        title: 'Attachments downloaded',
        detail: `${result.fetched} fetched, ${result.alreadyPresent} already present.`,
      });
      closed = true;
      resolvePrompt(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!closed) setDownloading(false);
    }
  };

  return (
    <Modal open title={prompt.title} onClose={close} className="max-w-2xl" bodyClassName="gap-4">
      <div className="space-y-2 text-sm text-text-muted">
        <p>{prompt.detail}</p>
        <p className="text-xs text-text-dim">
          File bytes are device-local and stay outside workspace.json. Downloads are recorded in
          this machine&apos;s local metadata so request send and plan execution can read the file.
        </p>
      </div>

      <div className="rounded-sm border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-text-primary">
            {prompt.items.length} required file{prompt.items.length === 1 ? '' : 's'}
          </span>
          <span className="text-text-dim">{formatBytes(totalSize)}</span>
        </div>
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {prompt.items.map((item) => (
            <li
              key={`${item.source}:${item.linkedWorkspaceId ?? 'local'}:${item.slotId}`}
              className="rounded-sm border border-border-subtle bg-card p-2"
            >
              <div className="flex items-start gap-2">
                <FileArchive size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-xs font-medium text-text-primary">
                      {item.filename}
                    </span>
                    <span className="rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-warning">
                      missing
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-text-dim">
                    <span>{formatBytes(item.size ?? Number.NaN)}</span>
                    <span>{item.mimeType}</span>
                    <span>
                      {item.source === 'workspace' ? 'Current workspace' : 'Linked workspace'}
                    </span>
                  </div>
                  <p className="mt-1 text-[0.6875rem] text-text-muted">
                    Required by {formatRequiredBy(item.requiredBy)}
                  </p>
                  <p className="mt-1 font-mono text-[0.625rem] text-text-dim">
                    {item.localPath
                      ? `local metadata: ${item.localPath}`
                      : 'not downloaded locally'}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <p className="rounded-sm border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={close}
          disabled={downloading}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary disabled:opacity-50"
        >
          <X size={12} aria-hidden="true" />
          Cancel execution
        </button>
        <button
          type="button"
          onClick={() => void downloadAndContinue()}
          disabled={downloading}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {downloading ? (
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          ) : (
            <Download size={12} aria-hidden="true" />
          )}
          {downloading ? 'Downloading...' : 'Download and continue'}
        </button>
      </div>
    </Modal>
  );
}

function formatRequiredBy(items: Array<{ requestId: string; requestName: string }>): string {
  const names = Array.from(new Set(items.map((item) => item.requestName || item.requestId)));
  if (names.length === 0) return 'this request';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}
