import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import type { WorkingBranch } from '@apicircle/shared';

// Branch change sources — changes an edition makes on the working branch that
// are not Studio's own.
//
// Studio pushes its workspace (the `.apicircle/` files) to the working branch,
// previews what it is about to push, and opens the pull request. An edition can
// change OTHER files on that same branch — the Lens edition's Code editor saves
// source code into a local clone — and those changes belong in the same
// review, the same push and the same pull request, whichever app mode the user
// pushes from. A source is how the edition says so: it reports a summary,
// renders its own section of the changes preview, pushes its part after
// Studio's commit, and describes itself in the pull-request body.
//
// Additive, and a no-op when unused: with no source registered (Studio
// standalone, `NO_BRANCH_CHANGE_SOURCES`) the working-branch card renders and
// behaves exactly as before.

export interface BranchChangeSummary {
  added: number;
  modified: number;
  removed: number;
  /** Every change the source has on this branch. */
  total: number;
  /** How many of them the next push carries — the user can leave some out. */
  included: number;
  /** Why the included changes can't be pushed right now, in the user's words. */
  blockedReason?: string;
}

export interface BranchChangeSectionProps {
  branch: WorkingBranch;
}

export interface BranchChangeSource {
  /** Stable id — the key of this source's part in a push outcome. */
  id: string;
  /** Section heading, and this part's name in push results ("Code changes"). */
  label: string;
  /**
   * The source's summary as an external store. `null` means it has nothing to
   * say about this branch (no clone, a different branch checked out…): the
   * card shows no section for it and pushes nothing from it.
   */
  summary: {
    subscribe(onChange: () => void): () => void;
    getSnapshot(): BranchChangeSummary | null;
  };
  /** Read the changes again — the card's Refresh does this alongside its own. */
  refresh?(): Promise<void>;
  /** This source's section of the changes preview. */
  Section: ComponentType<BranchChangeSectionProps>;
  /**
   * Push the included changes onto the working branch, after Studio's own
   * commit has landed. Resolves to the branch's new head on the remote, or
   * `null` when there was nothing to push; rejects with a message for the user.
   */
  push(ctx: { branch: WorkingBranch; message: string }): Promise<{ headSha: string } | null>;
  /** Markdown for the pull-request body, or `null` with nothing to add. */
  describeForPullRequest?(branch: WorkingBranch): Promise<string | null>;
}

/** Studio standalone: no edition changes anything else on the branch. */
export const NO_BRANCH_CHANGE_SOURCES: readonly BranchChangeSource[] = Object.freeze([]);

const BranchChangeSourcesContext =
  createContext<readonly BranchChangeSource[]>(NO_BRANCH_CHANGE_SOURCES);

export const BranchChangeSourcesProvider = BranchChangeSourcesContext.Provider;

export function useBranchChangeSources(): readonly BranchChangeSource[] {
  return useContext(BranchChangeSourcesContext);
}

export interface ActiveBranchChange {
  source: BranchChangeSource;
  summary: BranchChangeSummary;
}

const NO_ACTIVE: readonly ActiveBranchChange[] = Object.freeze([]);

/**
 * Every registered source that has something to say about the current branch,
 * with its live summary — re-rendering whenever any source's summary changes.
 * Studio standalone: always the same empty list.
 */
export function useActiveBranchChanges(): readonly ActiveBranchChange[] {
  const sources = useBranchChangeSources();
  const last = useRef<{
    sources: readonly BranchChangeSource[];
    snapshots: readonly (BranchChangeSummary | null)[];
    result: readonly ActiveBranchChange[];
  } | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsubscribes = sources.map((s) => s.summary.subscribe(onChange));
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    },
    [sources],
  );

  // A store snapshot must be the SAME value until something changed, or
  // useSyncExternalStore renders forever: the list is rebuilt only when a
  // source's summary (or the source list) is a different object.
  const getSnapshot = useCallback((): readonly ActiveBranchChange[] => {
    const snapshots = sources.map((s) => s.summary.getSnapshot());
    const prev = last.current;
    if (
      prev !== null &&
      prev.sources === sources &&
      prev.snapshots.every((summary, i) => summary === snapshots[i])
    ) {
      return prev.result;
    }
    const active = sources.flatMap((source, i) => {
      const summary = snapshots[i];
      return summary ? [{ source, summary }] : [];
    });
    const result = active.length === 0 ? NO_ACTIVE : active;
    last.current = { sources, snapshots, result };
    return result;
  }, [sources]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
