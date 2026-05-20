// Desktop auto-update banner. Mounted at App root; subscribes to
// `window.apicircleDesktop?.update.onAvailable` and shows a fixed-bottom
// toast-shaped banner with a single primary CTA ("Restart to install")
// and a dismiss affordance.
//
// Early Access caveat: API Circle Studio binaries are not code-signed
// yet, so macOS Gatekeeper / Windows SmartScreen will warn after the
// relaunch. The release-notes link goes to GitHub Releases where the
// install instructions live; we don't reproduce them inline to keep
// the banner small.

import { useEffect, useState } from 'react';
import { ArrowUpCircle, ExternalLink, X } from 'lucide-react';
import { cn } from './cn';

interface UpdateAvailablePayload {
  version: string;
  releaseNotesUrl: string | null;
  releaseDate: string | null;
}

interface UpdateBridge {
  onAvailable: (cb: (payload: UpdateAvailablePayload) => void) => () => void;
  applyUpdate: () => Promise<void>;
  checkNow: () => Promise<{ checked: boolean; reason?: string }>;
}

function getUpdateBridge(): UpdateBridge | null {
  // The bridge only exists on desktop. On web this returns null and we
  // render nothing — the banner has no meaning outside Electron.
  const win = globalThis as unknown as {
    apicircleDesktop?: { update?: UpdateBridge };
  };
  return win.apicircleDesktop?.update ?? null;
}

export function UpdateAvailableBanner() {
  const bridge = getUpdateBridge();
  const [pending, setPending] = useState<UpdateAvailablePayload | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.onAvailable((payload) => {
      setPending(payload);
      setDismissed(false);
    });
    return unsub;
  }, [bridge]);

  if (!bridge || !pending || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto fixed bottom-3 left-1/2 z-[70] flex max-w-md -translate-x-1/2 items-start gap-2',
        'rounded-sm border border-accent/40 bg-accent/10 px-3 py-2 text-xs shadow-elevated',
      )}
    >
      <ArrowUpCircle size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="font-medium text-text-primary">
          API Circle Studio v{pending.version} is ready to install
        </div>
        <p className="text-[0.6875rem] text-text-muted">
          Restart to apply the update. macOS or Windows may show a security warning the first time
          you run the new build — see the release notes for the right-click → Open step.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setApplying(true);
              void bridge.applyUpdate().catch(() => setApplying(false));
            }}
            disabled={applying}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-accent/50 bg-accent/20 px-2 text-[0.6875rem] text-accent hover:bg-accent/30 disabled:opacity-50"
          >
            {applying ? 'Restarting…' : 'Restart to install'}
          </button>
          {pending.releaseNotesUrl && (
            <a
              href={pending.releaseNotesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-6 items-center gap-1 text-[0.6875rem] text-text-muted hover:text-text-primary"
            >
              <ExternalLink size={10} aria-hidden="true" />
              Release notes
            </a>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update notice"
        className="ml-1 shrink-0 rounded-sm p-0.5 text-text-faint hover:text-text-primary"
      >
        <X size={11} aria-hidden="true" />
      </button>
    </div>
  );
}
