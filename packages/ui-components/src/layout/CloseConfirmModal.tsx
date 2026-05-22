import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Server, X } from 'lucide-react';
import { Modal } from '../primitives/Modal';
import { cn } from '../primitives/cn';

// =============================================================================
// CloseConfirmModal — pops when the user tries to quit the app while one or
// more mock servers are still running. Two phases:
//
//   1. **Asking**: lists the running mocks, lets the user Cancel (abort quit)
//      or Stop & close (drain then quit). Modal can't be dismissed with
//      Escape or backdrop click — that would silently cancel and lose the
//      drain we explicitly want.
//
//   2. **Shutting down**: a circular progress ring tracks how many mocks
//      have finished stopping. Once `complete` fires we leave the modal up
//      until the process exits — main calls `app.quit()` right after, so
//      the window goes away within a frame.
//
// The bridge methods are no-ops in the web build (window.apicircleDesktop
// is undefined). The effect short-circuits in that case, so this component
// is effectively dead UI there but still safe to mount.
// =============================================================================

interface RunningMock {
  serverId: string;
  port: number;
}

interface PromptPayload {
  runningMocks: RunningMock[];
}

interface ProgressPayload {
  completed: number;
  total: number;
}

interface LifecycleBridge {
  onPromptClose: (cb: (p: PromptPayload) => void) => () => void;
  onShutdownProgress: (cb: (p: ProgressPayload) => void) => () => void;
  onShutdownComplete: (cb: () => void) => () => void;
  cancelClose: () => Promise<void>;
  confirmClose: () => Promise<void>;
}

function getLifecycleBridge(): LifecycleBridge | null {
  const w = window as unknown as { apicircleDesktop?: { lifecycle?: LifecycleBridge } };
  return w.apicircleDesktop?.lifecycle ?? null;
}

type Phase = 'closed' | 'asking' | 'shutting-down' | 'complete';

export function CloseConfirmModal() {
  const [phase, setPhase] = useState<Phase>('closed');
  const [runningMocks, setRunningMocks] = useState<RunningMock[]>([]);
  const [progress, setProgress] = useState<ProgressPayload>({ completed: 0, total: 0 });
  // We need a stable reference to read the current phase from inside the
  // shutdown-progress handler — otherwise the closure captures whatever
  // phase was current on subscription (always 'closed').
  const phaseRef = useRef<Phase>('closed');
  phaseRef.current = phase;

  useEffect(() => {
    const bridge = getLifecycleBridge();
    if (!bridge) return;
    const offPrompt = bridge.onPromptClose(({ runningMocks: m }) => {
      setRunningMocks(m);
      setProgress({ completed: 0, total: m.length });
      setPhase('asking');
    });
    const offProgress = bridge.onShutdownProgress((p) => {
      setProgress(p);
      // Main fires the first progress event (0/total) before the user has
      // confirmed in odd race orderings; only advance the phase if we're
      // genuinely past the asking step.
      if (phaseRef.current === 'asking') setPhase('shutting-down');
    });
    const offComplete = bridge.onShutdownComplete(() => {
      setPhase('complete');
    });
    return () => {
      offPrompt();
      offProgress();
      offComplete();
    };
  }, []);

  const bridge = getLifecycleBridge();
  const open = phase !== 'closed';

  const handleCancel = () => {
    if (!bridge) return;
    void bridge.cancelClose();
    setPhase('closed');
  };

  const handleConfirm = () => {
    if (!bridge) return;
    // Optimistically swap to shutdown UI before the first progress event
    // arrives so the user sees immediate feedback. The progress effect
    // already covers the case where main beat us to the first event.
    setPhase('shutting-down');
    void bridge.confirmClose();
  };

  // Backdrop / Escape close are intentionally no-ops here: the right
  // dismiss action is "Cancel", which goes through cancelClose() so main
  // knows to abort the pending quit. A silent backdrop dismiss would leak
  // the quit-in-progress state and look like the app froze.
  const onModalDismiss = () => {
    if (phase === 'asking') handleCancel();
    // During shutdown / complete the modal is not user-dismissible.
  };

  return (
    <Modal
      open={open}
      onClose={onModalDismiss}
      title={phase === 'asking' ? 'Mock servers are running' : 'Closing API Circle'}
      className="max-w-md"
    >
      {phase === 'asking' && (
        <AskingBody runningMocks={runningMocks} onCancel={handleCancel} onConfirm={handleConfirm} />
      )}
      {(phase === 'shutting-down' || phase === 'complete') && <ProgressBody progress={progress} />}
    </Modal>
  );
}

function AskingBody({
  runningMocks,
  onCancel,
  onConfirm,
}: {
  runningMocks: RunningMock[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const count = runningMocks.length;
  return (
    <div className="flex flex-col gap-3 text-xs text-text-muted">
      <div className="flex items-start gap-2 rounded-sm border border-amber/40 bg-amber/5 p-2.5">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
        <p className="text-text-primary">
          {count === 1 ? '1 mock server is' : `${count} mock servers are`} still running. Closing
          API Circle will stop {count === 1 ? 'it' : 'them'}.
        </p>
      </div>

      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-sm border border-border-subtle bg-card p-2">
        {runningMocks.map((m) => (
          <li key={m.serverId} className="flex items-center gap-2 text-[0.6875rem]">
            <Server size={11} className="shrink-0 text-text-dim" aria-hidden="true" />
            <span className="truncate font-mono text-text-primary">{m.serverId}</span>
            <span className="ml-auto shrink-0 rounded-sm border border-success/40 bg-success/10 px-1.5 py-0.5 text-[0.625rem] text-success">
              port {m.port}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[0.6875rem]">
        Cancel to keep API Circle open. Stop &amp; close will gracefully stop each mock, release its
        port, and then quit.
      </p>

      <div className="mt-1 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-7 items-center rounded-sm border border-border bg-card px-3 text-[0.6875rem] text-text-primary hover:bg-card-hover"
        >
          <X size={11} className="mr-1" aria-hidden="true" />
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          autoFocus
          className="inline-flex h-7 items-center rounded-sm border border-danger/40 bg-danger/10 px-3 text-[0.6875rem] text-danger hover:bg-danger/20"
        >
          Stop &amp; close
        </button>
      </div>
    </div>
  );
}

function ProgressBody({ progress }: { progress: ProgressPayload }) {
  const { completed, total } = progress;
  // Guard against total=0 (e.g. the user clicked Stop & close in a race
  // where the last mock had already been stopped from another surface).
  // Render as already-complete rather than dividing by zero.
  const fraction = total === 0 ? 1 : completed / total;
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-xs text-text-muted">
      <ProgressRing fraction={fraction} label={total === 0 ? '' : `${completed}/${total}`} />
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-sm font-medium text-text-primary">
          {fraction >= 1 ? 'Mock servers stopped' : 'Stopping mock servers…'}
        </p>
        <p className="text-[0.6875rem]">
          {fraction >= 1
            ? 'Finalising shutdown — the window will close in a moment.'
            : `Releasing port for ${completed} of ${total} ${total === 1 ? 'server' : 'servers'}.`}
        </p>
      </div>
    </div>
  );
}

// Circular progress ring drawn with two stacked SVG circles. The background
// circle is the full track; the foreground circle uses stroke-dasharray +
// stroke-dashoffset to paint the completed arc. Sized to feel substantial
// without overwhelming the small confirm modal — 96px radius works at all
// supported display densities.
function ProgressRing({ fraction, label }: { fraction: number; label: string }) {
  const size = 96;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  const offset = circumference * (1 - clamped);
  const indeterminate = label === '';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={clamped}
        className={cn(indeterminate && 'animate-spin')}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(var(--border) / 0.6)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(var(--purple))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          // Start the arc at 12 o'clock instead of 3 o'clock — feels more
          // natural for a fill-up gauge.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-[stroke-dashoffset] duration-200 ease-out"
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {label ? (
          <span className="text-sm font-medium tabular-nums text-text-primary">{label}</span>
        ) : (
          <Loader2 size={20} className="animate-spin text-accent" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
