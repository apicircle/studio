import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  BranchChangeSourcesProvider,
  NO_BRANCH_CHANGE_SOURCES,
  useActiveBranchChanges,
  useBranchChangeSources,
  type ActiveBranchChange,
  type BranchChangeSource,
  type BranchChangeSummary,
} from './branchChanges';

function summaryStore(initial: BranchChangeSummary | null) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    store: {
      subscribe: vi.fn((cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      }),
      getSnapshot: () => value,
    },
    set(next: BranchChangeSummary | null) {
      value = next;
      listeners.forEach((cb) => cb());
    },
    listeners,
  };
}

const READY: BranchChangeSummary = { added: 1, modified: 0, removed: 0, total: 1, included: 1 };

function source(id: string, store: ReturnType<typeof summaryStore>['store']): BranchChangeSource {
  return {
    id,
    label: id,
    summary: store,
    Section: () => null,
    push: async () => null,
  };
}

describe('branch change sources', () => {
  it('are none in Studio standalone', () => {
    let seen: readonly BranchChangeSource[] | null = null;
    function Probe() {
      seen = useBranchChangeSources();
      return null;
    }
    render(<Probe />);
    expect(seen).toBe(NO_BRANCH_CHANGE_SOURCES);
    expect(Object.isFrozen(NO_BRANCH_CHANGE_SOURCES)).toBe(true);
  });

  it('lists only the sources with something to say, and follows their summaries', () => {
    const a = summaryStore(READY);
    const b = summaryStore(null);
    const sources = [source('a', a.store), source('b', b.store)];
    const seen: (readonly ActiveBranchChange[])[] = [];
    function Probe() {
      const active = useActiveBranchChanges();
      seen.push(active);
      return <p>{active.map((x) => `${x.source.id}:${x.summary.total}`).join(',')}</p>;
    }
    const { unmount } = render(
      <BranchChangeSourcesProvider value={sources}>
        <Probe />
      </BranchChangeSourcesProvider>,
    );
    expect(screen.getByText('a:1')).toBeInTheDocument();

    act(() => b.set({ ...READY, total: 3 }));
    expect(screen.getByText('a:1,b:3')).toBeInTheDocument();

    // A notification that changed nothing hands back the very same list.
    const before = seen[seen.length - 1];
    act(() => a.set(a.store.getSnapshot()));
    expect(seen[seen.length - 1]).toBe(before);

    act(() => {
      a.set(null);
      b.set(null);
    });
    expect(screen.getByText('', { selector: 'p' })).toBeInTheDocument();

    unmount();
    expect(a.listeners.size).toBe(0);
    expect(b.listeners.size).toBe(0);
  });

  it('starts over when the source list itself changes', () => {
    const a = summaryStore(READY);
    function Probe() {
      return <p>{useActiveBranchChanges().length}</p>;
    }
    const { rerender } = render(
      <BranchChangeSourcesProvider value={[source('a', a.store)]}>
        <Probe />
      </BranchChangeSourcesProvider>,
    );
    expect(screen.getByText('1')).toBeInTheDocument();
    rerender(
      <BranchChangeSourcesProvider value={NO_BRANCH_CHANGE_SOURCES}>
        <Probe />
      </BranchChangeSourcesProvider>,
    );
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
