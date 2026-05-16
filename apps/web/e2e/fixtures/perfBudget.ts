import type { Page } from '@playwright/test';

// Thin per-test perf-budget helpers. The catalog below is the source of
// truth for "slow enough to flag a regression" thresholds — exposed as
// constants so a test can reference the exact field its case maps to.
//
// Philosophy: budgets are pass/fail GATES, not benchmarks. They're
// generous (~3× the median observed elapsed) so they don't false-fire
// when CI is loaded, but they DO catch a 10× regression. If a budget
// starts to flake, raise it once with a comment — don't disable the
// test.

export const BUDGETS = {
  /** Click a tab; the new panel paints within this many ms. */
  panelSwitch: 3_000,
  /** Sidebar tree with N requests renders within this many ms. */
  treeRender: 4_000,
  /** Type 30 keystrokes into a debounced field; total time stays under. */
  rapidKeystrokes: 5_000,
  /** Open the editor with a huge active request body. */
  largeEditorOpen: 4_000,
  /** Single store-mutation propagates to the DOM within this many ms. */
  storeMutateToPaint: 2_500,
} as const;

export type BudgetKey = keyof typeof BUDGETS;

export interface PerfRun {
  /** Wall-clock duration in ms. */
  elapsedMs: number;
  /** Threshold the run was compared against. */
  budgetMs: number;
  /** True iff `elapsedMs <= budgetMs`. */
  withinBudget: boolean;
}

export async function measure(fn: () => Promise<void>): Promise<number> {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}

export async function measureUnderBudget(
  budget: BudgetKey,
  fn: () => Promise<void>,
): Promise<PerfRun> {
  const elapsedMs = await measure(fn);
  const budgetMs = BUDGETS[budget];
  return { elapsedMs, budgetMs, withinBudget: elapsedMs <= budgetMs };
}

// ---------------------------------------------------------------------------
// Synthetic-state injection. The renderer exposes `window.__apicircleStore`
// in non-production builds (see ui-components/src/store/workspaceStore.ts).
// These helpers wrap the most common shapes so per-test setup stays
// declarative.
// ---------------------------------------------------------------------------

export interface SyntheticRequest {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  folderId: string | null;
}

export interface SyntheticEnvVar {
  key: string;
  value: string;
  enabled: boolean;
  isSecret: boolean;
}

/**
 * Seed N requests directly into the workspace store at the root. Returns
 * the count of requests now in the tree (best-effort — the store shape
 * varies by phase; if the injection silently fails the count comes back
 * as the original size).
 */
export async function seedRequests(
  page: Page,
  count: number,
  namePrefix = 'perf-req-',
): Promise<number> {
  return page.evaluate(
    ({ n, prefix }) => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => unknown;
          setState?: (mut: (s: unknown) => unknown) => void;
        };
      };
      const store = w.__apicircleStore;
      if (!store?.setState) return -1;
      const before =
        (
          store.getState() as {
            synced?: { collections?: { requests?: Record<string, unknown> } };
          }
        ).synced?.collections?.requests ?? {};
      const beforeCount = Object.keys(before).length;
      store.setState((state) => {
        const s = state as {
          synced: {
            collections: {
              requests: Record<string, unknown>;
              tree: Array<{ kind: 'request'; requestId: string }>;
            };
          };
        };
        const requests = { ...s.synced.collections.requests };
        const tree = [...s.synced.collections.tree];
        for (let i = 0; i < n; i++) {
          const id = `synthetic-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
          requests[id] = {
            id,
            name: `${prefix}${i}`,
            folderId: null,
            method: 'GET',
            url: `https://api.example.test/synth/${i}`,
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { kind: 'inherit' },
            assertions: [],
            contextExtractions: [],
            description: '',
          };
          tree.push({ kind: 'request', requestId: id });
        }
        return {
          ...s,
          synced: {
            ...s.synced,
            collections: { ...s.synced.collections, requests, tree },
          },
        };
      });
      const after =
        (
          store.getState() as {
            synced?: { collections?: { requests?: Record<string, unknown> } };
          }
        ).synced?.collections?.requests ?? {};
      return Object.keys(after).length - beforeCount;
    },
    { n: count, prefix: namePrefix },
  );
}

/**
 * Seed N environment variables into the active environment (or a new
 * "Perf" env if none exists). Returns the count of vars now present.
 */
export async function seedEnvVars(page: Page, count: number): Promise<number> {
  return page.evaluate((n) => {
    const w = window as unknown as {
      __apicircleStore?: {
        getState: () => unknown;
        setState?: (mut: (s: unknown) => unknown) => void;
      };
    };
    const store = w.__apicircleStore;
    if (!store?.setState) return -1;
    store.setState((state) => {
      const s = state as {
        synced: {
          environments: Array<{
            id: string;
            name: string;
            variables: Array<{ key: string; value: string; enabled: boolean; isSecret: boolean }>;
          }>;
        };
      };
      const environments = [...s.synced.environments];
      let env = environments[0];
      if (!env) {
        env = { id: `synthetic-env-${Date.now()}`, name: 'Perf', variables: [] };
        environments.push(env);
      }
      const variables = [...env.variables];
      for (let i = 0; i < n; i++) {
        variables.push({
          key: `var_${i}_${Date.now()}`,
          value: `value-${i}`,
          enabled: true,
          isSecret: false,
        });
      }
      environments[environments.indexOf(env)] = { ...env, variables };
      return { ...s, synced: { ...s.synced, environments } };
    });
    const ws = (
      store.getState() as {
        synced?: { environments?: Array<{ variables: unknown[] }> };
      }
    ).synced?.environments;
    return ws?.[0]?.variables.length ?? -1;
  }, count);
}

/**
 * Seed N folders nested under the root. Returns count actually added.
 */
export async function seedFolders(page: Page, count: number): Promise<number> {
  return page.evaluate((n) => {
    const w = window as unknown as {
      __apicircleStore?: {
        getState: () => unknown;
        setState?: (mut: (s: unknown) => unknown) => void;
      };
    };
    const store = w.__apicircleStore;
    if (!store?.setState) return -1;
    store.setState((state) => {
      const s = state as {
        synced: {
          collections: {
            folders: Record<string, unknown>;
            tree: Array<{ kind: 'folder'; folderId: string; children: unknown[] }>;
          };
        };
      };
      const folders = { ...(s.synced.collections.folders ?? {}) };
      const tree = [...s.synced.collections.tree];
      for (let i = 0; i < n; i++) {
        const id = `synthetic-folder-${Date.now()}-${i}`;
        folders[id] = { id, name: `Folder ${i}`, parentId: null };
        tree.push({ kind: 'folder', folderId: id, children: [] });
      }
      return {
        ...s,
        synced: {
          ...s.synced,
          collections: { ...s.synced.collections, folders, tree },
        },
      };
    });
    return n;
  }, count);
}

/**
 * Hooks an event listener that resolves once the next render tick has
 * flushed. Useful when measuring "store mutation → DOM paint".
 */
export async function waitForNextPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
