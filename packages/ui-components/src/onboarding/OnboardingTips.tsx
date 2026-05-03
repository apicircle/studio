import { useEffect, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';

const STORAGE_KEY = 'apicircle:onboarding-dismissed-v1';

const TIPS = [
  {
    title: 'Welcome to API Circle Studio',
    body: 'A sample request is loaded in the sidebar — open it and hit Send to see a real response.',
  },
  {
    title: 'Folders & requests',
    body: 'Hover any folder to add a request inside it, add nested folders, or delete the folder and its contents.',
  },
  {
    title: 'Environments are layered',
    body: 'Tick environments in the Environments sidebar to add them to the global layer. Reorder to set lookup priority — first match wins.',
  },
  {
    title: 'Encrypted values & Vault',
    body: 'Encrypt env values with your local master key, or use the Vault button to reference a labelled secret as {{LABEL}}.',
  },
];

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function OnboardingTips() {
  const [dismissed, setDismissed] = useState<boolean>(true);
  const [step, setStep] = useState(0);

  // Defer reading localStorage to a mount effect so SSR/no-storage envs stay
  // happy and so the panel doesn't flash on top of an already-dismissed state.
  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Non-fatal — the user just sees the panel again next visit.
    }
    setDismissed(true);
  };

  if (dismissed) return null;

  const tip = TIPS[step];
  const isLast = step === TIPS.length - 1;

  return (
    <div
      role="dialog"
      aria-label="Onboarding tip"
      className="pointer-events-auto fixed bottom-4 right-4 z-40 w-80 rounded-md border border-accent/40 bg-card p-3 text-xs text-text-primary shadow-xl"
    >
      <div className="mb-2 flex items-start gap-2">
        <Lightbulb size={14} className="mt-0.5 shrink-0 text-accent" />
        <div className="flex-1">
          <p className="font-medium">{tip.title}</p>
          <p className="mt-1 text-text-muted">{tip.body}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-text-faint hover:text-text-primary"
          aria-label="Dismiss onboarding"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-dim">
          {step + 1} / {TIPS.length}
        </span>
        <div className="flex gap-1">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="rounded-sm border border-border bg-surface px-2 py-0.5 text-[11px] text-text-muted hover:border-accent hover:text-text-primary"
            >
              Back
            </button>
          )}
          {!isLast && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(TIPS.length - 1, s + 1))}
              className="rounded-sm border border-accent bg-accent/10 px-2 py-0.5 text-[11px] text-text-primary hover:bg-accent/20"
            >
              Next
            </button>
          )}
          {isLast && (
            <button
              type="button"
              onClick={dismiss}
              className="rounded-sm border border-accent bg-accent/10 px-2 py-0.5 text-[11px] text-text-primary hover:bg-accent/20"
            >
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
