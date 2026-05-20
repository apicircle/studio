// Debounced workspace persistence.
//
// Why: every store mutation in `commitSynced` used to call `saveSynced(next)`,
// which serializes the ENTIRE workspace JSON (potentially 1 MiB+) and writes
// it to IndexedDB. Burst typing in an editor field — URL bar, headers, body —
// produces dozens of mutations per second, each round-tripping the whole doc.
// On the audit's hot-path profile this was the #1 contributor to keystroke
// latency.
//
// What: we buffer the latest snapshot of `synced` and `local` in module
// scope and write it after `PERSIST_DEBOUNCE_MS` of quiet. Intermediate
// snapshots are dropped — the user only cares about what's on disk when
// they walk away from the keyboard, push to git, or refresh.
//
// Coalescing: when `commitSynced` writes BOTH synced and local in the same
// tick (secret-index recompute branch), we end up with both pending and the
// flush does a single `saveBoth` transaction — one IDB round trip instead
// of two.
//
// Crash safety: a `beforeunload` listener kicks the writes synchronously
// before navigation; IndexedDB commits queued transactions even after the
// listener returns. Sensitive paths (git push, hydrate, workspace switch)
// call `flushPendingPersist()` explicitly to await the disk write.

import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import {
  saveBoth as defaultSaveBoth,
  saveLocal as defaultSaveLocal,
  saveSynced as defaultSaveSynced,
} from './workspaceStorage';

/** Quiet-time window before a queued write actually hits IndexedDB.
 *  250 ms is fast enough that a crash mid-typing loses <1 second of edits,
 *  slow enough to coalesce sub-second burst typing into a single write. */
export const PERSIST_DEBOUNCE_MS = 250;

// Writer functions held behind module-scope refs. We bind them to the real
// `workspaceStorage` exports by default, but tests can replace them via
// `__setPersistersForTests` without fighting vitest's mock-hoisting around
// same-directory specifiers (`./workspaceStorage` resolves twice in our
// test layout — once from the test, once from this module — and only one
// of those bindings gets the spy).
let saveSynced = defaultSaveSynced;
let saveLocal = defaultSaveLocal;
let saveBoth = defaultSaveBoth;

export interface PersisterOverrides {
  saveSynced?: typeof defaultSaveSynced;
  saveLocal?: typeof defaultSaveLocal;
  saveBoth?: typeof defaultSaveBoth;
}

/** Test seam — swap out the underlying writers. Pass an empty object to
 *  restore the real persisters. */
export function __setPersistersForTests(impl: PersisterOverrides): void {
  saveSynced = impl.saveSynced ?? defaultSaveSynced;
  saveLocal = impl.saveLocal ?? defaultSaveLocal;
  saveBoth = impl.saveBoth ?? defaultSaveBoth;
}

let pendingSynced: WorkspaceSynced | null = null;
let pendingLocal: WorkspaceLocal | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Set while a write is on the wire. Subsequent flushes await it so the
 *  on-disk order matches the call order even if a flush is requested while
 *  a previous flush is still settling. */
let inflight: Promise<void> | null = null;

function scheduleFlush(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushPendingPersist();
  }, PERSIST_DEBOUNCE_MS);
}

/** Queue a synced-workspace write. Replaces any previously-queued synced
 *  snapshot — only the most recent value is ever written to disk. */
export function queueSaveSynced(synced: WorkspaceSynced): void {
  pendingSynced = synced;
  scheduleFlush();
}

/** Queue a local-workspace write. Same coalescing semantics as
 *  `queueSaveSynced`. */
export function queueSaveLocal(local: WorkspaceLocal): void {
  pendingLocal = local;
  scheduleFlush();
}

/** Queue both halves in one go. When the debounce fires we write them in
 *  a single `saveBoth` IDB transaction. */
export function queueSaveBoth(synced: WorkspaceSynced, local: WorkspaceLocal): void {
  pendingSynced = synced;
  pendingLocal = local;
  scheduleFlush();
}

/**
 * Force any pending writes to disk and await completion. Call this from:
 *
 * - Sensitive control transitions (git push, hydrate completion, workspace
 *   switch, snapshot capture) where stale in-flight writes would corrupt
 *   the operation if they landed AFTER the transition completes.
 *
 * - Test setup/teardown that needs determinism.
 *
 * No-op when nothing is queued. Safe to call concurrently with itself —
 * `inflight` serialises overlapping flushes.
 */
export async function flushPendingPersist(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const synced = pendingSynced;
  const local = pendingLocal;
  pendingSynced = null;
  pendingLocal = null;
  if (!synced && !local) {
    // Still wait on any prior flush — caller relies on "all writes that
    // were queued before this call have landed".
    if (inflight) {
      try {
        await inflight;
      } catch {
        /* logged in the inflight branch */
      }
    }
    return;
  }
  if (inflight) {
    try {
      await inflight;
    } catch {
      /* errors will be reported by the prior caller; carry on */
    }
  }
  let work: Promise<void>;
  if (synced && local) {
    work = saveBoth(synced, local);
  } else if (synced) {
    work = saveSynced(synced);
  } else {
    // local must be set here (early-return above covers both-null).
    work = saveLocal(local!);
  }
  inflight = work;
  try {
    await work;
  } finally {
    if (inflight === work) inflight = null;
  }
}

/**
 * Test helper: drop pending writes WITHOUT flushing them to disk. Use in
 * test cleanup between cases so a stale pending write from a previous test
 * can't leak into the next.
 */
export function resetPendingPersistForTests(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  pendingSynced = null;
  pendingLocal = null;
  inflight = null;
}

/**
 * Best-effort flush on `beforeunload`. Browsers commit IndexedDB writes
 * queued before the listener returns even though we can't await the
 * promise here. Wired once at module load — no-op in non-DOM environments
 * (vitest, node CLI).
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    void flushPendingPersist();
  });
}
