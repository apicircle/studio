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
      const now = new Date().toISOString();
      store.setState((state) => {
        // `collections.tree` is a single FolderNode whose `.children` is an
        // array of `{ kind, id }`; `requests` / `folders` are keyed records.
        const s = state as {
          synced: {
            collections: {
              requests: Record<string, unknown>;
              folders: Record<string, unknown>;
              tree: { id: string; type: string; children: Array<{ kind: string; id: string }> };
            };
          };
        };
        const requests = { ...s.synced.collections.requests };
        const children = [...s.synced.collections.tree.children];
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
            auth: { type: 'inherit' },
            assertions: [],
            contextVars: [],
            extractions: [],
            createdAt: now,
            updatedAt: now,
          };
          children.push({ kind: 'request', id });
        }
        return {
          ...s,
          synced: {
            ...s.synced,
            collections: {
              ...s.synced.collections,
              requests,
              tree: { ...s.synced.collections.tree, children },
            },
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
      // `environments` is `{ items: Record<name,Environment>; activeName; ... }`.
      // An `Environment` is `{ name, variables }`; each variable is
      // `{ key, value, encrypted }`.
      const s = state as {
        synced: {
          environments: {
            items: Record<
              string,
              { name: string; variables: Array<{ key: string; value: string; encrypted: boolean }> }
            >;
            activeName: string | null;
            priorityOrder: Array<{ kind: 'local'; name: string }>;
          };
        };
      };
      const items = { ...s.synced.environments.items };
      const existingName = Object.keys(items)[0];
      const envName = existingName ?? 'Perf';
      const env = items[envName] ?? { name: envName, variables: [] };
      const variables = [...env.variables];
      for (let i = 0; i < n; i++) {
        variables.push({ key: `var_${i}_${Date.now()}`, value: `value-${i}`, encrypted: false });
      }
      items[envName] = { ...env, variables };
      const priorityOrder = s.synced.environments.priorityOrder.some((p) => p.name === envName)
        ? s.synced.environments.priorityOrder
        : [...s.synced.environments.priorityOrder, { kind: 'local' as const, name: envName }];
      return {
        ...s,
        synced: {
          ...s.synced,
          environments: {
            ...s.synced.environments,
            items,
            activeName: s.synced.environments.activeName ?? envName,
            priorityOrder,
          },
        },
      };
    });
    const items = (
      store.getState() as {
        synced?: { environments?: { items?: Record<string, { variables: unknown[] }> } };
      }
    ).synced?.environments?.items;
    const first = items ? Object.values(items)[0] : undefined;
    return first?.variables.length ?? -1;
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
      // `folders` is a keyed record; the tree is a single FolderNode whose
      // `.children` holds `{ kind, id }` refs.
      const s = state as {
        synced: {
          collections: {
            folders: Record<string, unknown>;
            tree: { id: string; type: string; children: Array<{ kind: string; id: string }> };
          };
        };
      };
      const folders = { ...(s.synced.collections.folders ?? {}) };
      const children = [...s.synced.collections.tree.children];
      for (let i = 0; i < n; i++) {
        const id = `synthetic-folder-${Date.now()}-${i}`;
        folders[id] = { id, name: `Folder ${i}`, parentId: null };
        children.push({ kind: 'folder', id });
      }
      return {
        ...s,
        synced: {
          ...s.synced,
          collections: {
            ...s.synced.collections,
            folders,
            tree: { ...s.synced.collections.tree, children },
          },
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
