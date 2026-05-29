import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Compass, X } from 'lucide-react';
import type { PanelId } from '@apicircle/shared';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';

// Completion marker. Bumped to v2 when the four static tips were replaced
// with the guided spotlight tour — a stale v1 marker should NOT suppress
// the new tour, so the key name changed.
const STORAGE_KEY = 'apicircle:onboarding-tour-done-v2';
// Custom event the rest of the app dispatches to replay the tour — e.g.
// the "Re-launch onboarding tour" button in the Help Center footer.
const REPLAY_EVENT = 'apicircle:onboarding-replay';

/**
 * Public re-launch handle — clears the completion marker and tells any
 * mounted OnboardingTour instance to restart from step one.
 */
export function replayOnboarding(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage disabled — the dispatch below still restarts the live tour.
  }
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

/**
 * A single tour stop.
 *
 * - `panel` — the tour navigates here before the step renders, so the
 *   spotlighted control (and the panel behind the dim) is actually on
 *   screen.
 * - `target` — the `data-tour` attribute of the element to spotlight.
 *   When omitted, or when no matching element is found (e.g. the Send
 *   button when no request is open), the card centres itself and the
 *   step reads as a plain explainer — the tour never gets stuck.
 */
interface TourStep {
  id: string;
  title: string;
  body: string;
  panel?: PanelId;
  target?: string;
}

const STEPS: ReadonlyArray<TourStep> = [
  {
    id: 'welcome',
    title: 'Welcome to API Circle Studio',
    body: "Take a two-minute tour of the workspace. We'll stop on every panel and highlight what each one does. Use Next and Back to move — or press Esc to leave the tour anytime.",
  },
  {
    id: 'panel-nav',
    title: 'Nine panels, one per workflow',
    body: 'These tabs switch between the nine panels — one for each stage of API work. The tour walks through them in order.',
    target: 'panel-nav',
  },
  {
    id: 'workspace',
    title: 'Workspace',
    body: 'Your collection lives in a JSON document backed by a Git branch. Commit changes here and collaborate with your team through pull requests.',
    panel: 'workspace',
    target: 'nav-workspace',
  },
  {
    id: 'link-workspace',
    title: 'Link Workspace',
    body: "Connect your GitHub account and link other teams' workspaces, so you can call their requests without copying anything.",
    panel: 'link-workspace',
    target: 'nav-link-workspace',
  },
  {
    id: 'editor',
    title: 'Editor',
    body: 'This is where you build and send requests. The sidebar on the left holds your collection of folders and requests.',
    panel: 'editor',
    target: 'nav-editor',
  },
  {
    id: 'editor-actions',
    title: 'Add a request',
    body: 'Open this menu to create a request or folder — or import an existing Postman, Insomnia, or OpenAPI collection.',
    panel: 'editor',
    target: 'editor-actions',
  },
  {
    id: 'send-request',
    title: 'Send it',
    body: 'Pick a method, type a URL, then hit Send (or Ctrl/Cmd+Enter). Variables and secrets from your active environment resolve automatically.',
    panel: 'editor',
    target: 'send-request',
  },
  {
    id: 'env',
    title: 'Environments',
    body: 'Environments are layered. Tick several to stack them — when a variable is looked up, the first match wins.',
    panel: 'env',
    target: 'nav-env',
  },
  {
    id: 'dock-variables',
    title: 'Variables inspector',
    body: 'Open this to see every variable currently in scope and trace exactly which layer each value resolves from.',
    target: 'dock-variables',
  },
  {
    id: 'dock-vault',
    title: 'Secret Vault',
    body: 'Store API keys and tokens encrypted with your local master key. Reference any secret in a request as {{LABEL}}.',
    target: 'dock-vault',
  },
  {
    id: 'dock-assets',
    title: 'Global Assets',
    body: 'Reusable schemas, GraphQL definitions, and files for requests, mocks, and execution plans. Missing linked files download on demand before a run continues.',
    target: 'dock-assets',
  },
  {
    id: 'execution',
    title: 'Execution',
    body: 'Run a whole folder or collection in sequence, check assertions, and review a pass/fail report for the run.',
    panel: 'execution',
    target: 'nav-execution',
  },
  {
    id: 'history',
    title: 'History',
    body: 'Every request you send is recorded here. Inspect a past response or replay any earlier run.',
    panel: 'history',
    target: 'nav-history',
  },
  {
    id: 'mocks',
    title: 'Mocks',
    body: 'Turn an OpenAPI, Postman, or Insomnia spec into a mock server and scan endpoints in the same compact method-and-path style as the Editor.',
    panel: 'mocks',
    target: 'nav-mocks',
  },
  {
    id: 'mcp',
    title: 'MCP',
    body: 'Expose this workspace to AI clients like Claude, Cursor, and Copilot. Open MCP → Connection — the top of the tab shows the workspace-mirror path and a Refresh that pulls in CLI / MCP edits. The four-step "Set up your AI client" flow (install → pick client → paste snippet → restart) sits below for first-time wiring.',
    panel: 'mcp',
    target: 'nav-mcp',
  },
  {
    id: 'workspace-switcher',
    title: 'Switch workspaces',
    body: 'Jump between workspaces or create a new one. Each keeps its own collections, environments, and GitHub connection.',
    target: 'workspace-switcher',
  },
  {
    id: 'settings',
    title: 'Settings & appearance',
    body: 'Theme, font family, text size, and behaviour toggles all live here. Click Theme or Font family to open the list, hover an option for one second to preview it, or use keyboard navigation before applying.',
    target: 'settings',
  },
  {
    id: 'help',
    title: 'Help Center',
    body: 'Searchable documentation for every feature. You can re-launch this tour anytime from the button at the bottom of a help article.',
    panel: 'help',
    target: 'nav-help',
  },
  {
    id: 'done',
    title: "You're all set",
    body: "That's the whole workspace. A sample request is waiting in the Editor — open it and hit Send to see a live response. Happy building.",
  },
];

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Card geometry. The height is an estimate used only for placement and
// viewport clamping — the card itself sizes to its content.
const CARD_WIDTH = 340;
const CARD_HEIGHT_ESTIMATE = 240;
const GAP = 16;
const MARGIN = 12;
const SPOTLIGHT_PADDING = 8;

function readDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Non-fatal — the tour just shows again next visit.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rectsEqual(a: TargetRect | null, b: TargetRect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/**
 * Positions the explainer card relative to the spotlighted element,
 * picking the first side with enough room (below → above → right →
 * left) and clamping the result inside the viewport. With no target the
 * card centres itself.
 */
function cardStyle(rect: TargetRect | null): React.CSSProperties {
  if (rect === null) {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: CARD_WIDTH,
    };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBelow = vh - (rect.top + rect.height);
  const spaceAbove = rect.top;
  const spaceRight = vw - (rect.left + rect.width);
  const spaceLeft = rect.left;

  let top: number;
  let left: number;
  if (spaceBelow >= CARD_HEIGHT_ESTIMATE + GAP) {
    top = rect.top + rect.height + GAP;
    left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
  } else if (spaceAbove >= CARD_HEIGHT_ESTIMATE + GAP) {
    top = rect.top - GAP - CARD_HEIGHT_ESTIMATE;
    left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
  } else if (spaceRight >= CARD_WIDTH + GAP) {
    left = rect.left + rect.width + GAP;
    top = rect.top + rect.height / 2 - CARD_HEIGHT_ESTIMATE / 2;
  } else if (spaceLeft >= CARD_WIDTH + GAP) {
    left = rect.left - GAP - CARD_WIDTH;
    top = rect.top + rect.height / 2 - CARD_HEIGHT_ESTIMATE / 2;
  } else {
    top = rect.top + rect.height + GAP;
    left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
  }
  return {
    top: clamp(top, MARGIN, Math.max(MARGIN, vh - CARD_HEIGHT_ESTIMATE - MARGIN)),
    left: clamp(left, MARGIN, Math.max(MARGIN, vw - CARD_WIDTH - MARGIN)),
    width: CARD_WIDTH,
  };
}

export function OnboardingTour() {
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);

  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);
  // The panel the user was on when the tour started — restored on exit so
  // the tour doesn't strand them on Help Center.
  const startPanelRef = useRef<PanelId | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const startTour = useCallback(() => {
    startPanelRef.current = useWorkspaceStore.getState().activePanel;
    setStepIndex(0);
    setRect(null);
    setActive(true);
  }, []);

  const endTour = useCallback(() => {
    writeDone();
    setActive(false);
    setRect(null);
    const back = startPanelRef.current;
    if (back) setActivePanel(back);
  }, [setActivePanel]);

  // First-run auto-start + replay wiring.
  useEffect(() => {
    if (!readDone()) startTour();
    const onReplay = () => startTour();
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, [startTour]);

  // Navigate to the step's panel so the spotlighted control is mounted.
  useEffect(() => {
    if (!active) return;
    const panel = STEPS[stepIndex]?.panel;
    if (panel) setActivePanel(panel);
  }, [active, stepIndex, setActivePanel]);

  // Track the spotlight target. Polls (via rAF) only until the element
  // mounts — panel navigation and async panel content can take a few
  // frames — then stops. A ResizeObserver plus scroll/resize listeners
  // keep the rect synced afterwards without a perpetual animation loop.
  useEffect(() => {
    if (!active) return;
    // This effect is the single owner of `rect` — clear the previous
    // step's spotlight up front, then re-derive it for the new step.
    setRect(null);
    const step = STEPS[stepIndex];
    if (!step?.target) return;
    const selector = `[data-tour="${step.target}"]`;
    let cancelled = false;
    let pollFrame = 0;
    let attempts = 0;
    let scrolled = false;
    let observer: ResizeObserver | null = null;

    const measure = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const next: TargetRect = { top: r.top, left: r.left, width: r.width, height: r.height };
      setRect((prev) => (rectsEqual(prev, next) ? prev : next));
    };

    const syncFromDom = () => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) measure(el);
    };

    const locate = (): boolean => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return false;
      if (!scrolled) {
        scrolled = true;
        try {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch {
          // scrollIntoView is a no-op in some test environments.
        }
      }
      measure(el);
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(syncFromDom);
        observer.observe(el);
      }
      return true;
    };

    const poll = () => {
      if (cancelled) return;
      // ~1s budget for the element to mount, then give up — the step
      // falls back to a centred card rather than spinning forever.
      if (locate() || attempts >= 60) return;
      attempts += 1;
      pollFrame = requestAnimationFrame(poll);
    };
    poll();

    window.addEventListener('resize', syncFromDom);
    window.addEventListener('scroll', syncFromDom, true);
    return () => {
      cancelled = true;
      cancelAnimationFrame(pollFrame);
      observer?.disconnect();
      window.removeEventListener('resize', syncFromDom);
      window.removeEventListener('scroll', syncFromDom, true);
    };
  }, [active, stepIndex]);

  // Move focus into the card on each step for keyboard + screen-reader users.
  useEffect(() => {
    if (active) cardRef.current?.focus();
  }, [active, stepIndex]);

  const goNext = useCallback(() => {
    if (stepIndex >= STEPS.length - 1) {
      endTour();
      return;
    }
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }, [stepIndex, endTour]);

  const goBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  if (!active) return null;

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const titleId = 'onboarding-tour-title';
  const bodyId = 'onboarding-tour-body';

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Swallow so the app-wide Escape shortcut doesn't also fire.
      e.stopPropagation();
      endTour();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goNext();
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goBack();
      return;
    }
    if (e.key === 'Tab') {
      // Trap focus inside the card — it's the only interactive surface.
      const card = cardRef.current;
      if (!card) return;
      const focusables = card.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[1000]" onKeyDown={onKeyDown} data-testid="onboarding-tour">
      {/* Click shield. When a target is spotlit, the spotlight ring's
          box-shadow supplies the dim, so this layer stays transparent and
          only exists to block stray clicks on the app behind the tour.
          With no target it dims the whole screen itself. */}
      <div aria-hidden="true" className={cn('absolute inset-0', rect === null && 'bg-black/60')} />

      {rect !== null && (
        <div
          aria-hidden="true"
          className="absolute rounded-lg"
          style={{
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + SPOTLIGHT_PADDING * 2,
            height: rect.height + SPOTLIGHT_PADDING * 2,
            border: '2px solid var(--purple)',
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
            pointerEvents: 'none',
            transition: 'top 140ms ease, left 140ms ease, width 140ms ease, height 140ms ease',
          }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="absolute flex flex-col gap-3 rounded-lg border border-accent/40 bg-card p-4 text-text-primary shadow-2xl outline-none"
        style={cardStyle(rect)}
      >
        <div className="flex items-start gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-accent/15 text-accent">
            <Compass size={14} aria-hidden="true" />
          </span>
          <div className="flex-1">
            <p className="text-[0.625rem] font-medium uppercase tracking-wider text-text-dim">
              Quick tour · {stepIndex + 1} of {STEPS.length}
            </p>
            <h2 id={titleId} className="mt-0.5 text-sm font-semibold text-text-primary">
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={endTour}
            aria-label="Close tour"
            className="rounded-sm p-0.5 text-text-faint hover:bg-surface hover:text-text-primary"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <p id={bodyId} className="text-xs leading-relaxed text-text-muted">
          {step.body}
        </p>

        <div
          className="h-1 w-full overflow-hidden rounded-full bg-surface"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={stepIndex + 1}
          aria-label="Tour progress"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={endTour}
            className="text-[0.6875rem] text-text-dim hover:text-text-primary"
          >
            {isLast ? 'Close' : 'Skip tour'}
          </button>
          <div className="flex gap-1.5">
            {!isFirst && (
              <button
                type="button"
                onClick={goBack}
                className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2.5 text-[0.6875rem] text-text-muted hover:border-accent hover:text-text-primary"
              >
                <ArrowLeft size={11} aria-hidden="true" />
                Back
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/50 bg-accent/15 px-2.5 text-[0.6875rem] font-medium text-accent hover:bg-accent/25"
            >
              {isLast ? 'Finish tour' : 'Next'}
              {!isLast && <ArrowRight size={11} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
