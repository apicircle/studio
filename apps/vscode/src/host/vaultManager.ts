import type { SecretCryptoMeta } from '@apicircle/shared';
import {
  decryptString,
  encryptString,
  initSecretCrypto,
  serializePayload,
  tryParsePayload,
  unlockSecretCrypto,
} from '@apicircle/core';

// =============================================================================
// VsCodeVaultManager — owns the per-workspace AES-GCM master key in memory,
// drives auto-lock by inactivity, and exposes decrypt-on-demand for the
// EnvironmentView + commands.
//
// **Why per-workspace?** Each workspace has its own `synced.secretCrypto`
// blob (salt + verifier baked at setup time). A user can keep multiple
// workspaces unlocked simultaneously; locking one does NOT touch the others.
//
// **Why in-memory only?** The desktop app caches the unlocked key in
// IndexedDB; that's safe there because the master key is wrapped via the
// OS keychain (`safeStorage`). VS Code's `SecretStorage` API uses the OS
// keychain too, but Phase 4 ships the "passphrase only in process memory"
// model intentionally — it matches the web build's behaviour and lets us
// add an OS-keychain "remember on this device" toggle as an explicit
// follow-up (Phase 5) instead of hiding the cost in defaults.
//
// **Lifecycle:**
//   • initialize(workspaceId, passphrase) → call once when the user creates a
//     passphrase. Generates the SecretCrypto blob (caller persists via
//     `applyMutation({kind:'secret.crypto.set', crypto})`) and caches the key.
//   • unlock(workspaceId, passphrase, blob) → call when a workspace already
//     has a SecretCrypto blob and the user enters the passphrase.
//   • lock(workspaceId) → wipe the cached key.
//   • lockAll() → extension deactivation / "Lock all" command.
//   • isUnlocked(workspaceId) → status-bar query.
//   • decryptValue(workspaceId, ciphertext) / encryptValue → the only way to
//     touch a secret value. Auto-locked workspaces throw a typed error so
//     callers can surface "unlock first" UX.
//   • touch() — call on every secret access; resets the auto-lock timer.
//
// **Auto-lock:** the timeout is driven by a single setting
// (`apicircle.secrets.autoLockMinutes`); `setAutoLockMinutes(n)` (called from
// the ConfigurationChange listener in extension.ts) re-arms the timer with
// the new value. `0` disables auto-lock entirely.
//
// **Threading:** all crypto ops are awaited inline. There is no I/O — the
// workspace doc reads + writes happen one level up in the command layer.
// That keeps this class pure and unit-testable without VS Code mocks.
// =============================================================================

export class VaultLockedError extends Error {
  constructor(workspaceId: string) {
    super(
      `Secret vault for workspace "${workspaceId}" is locked. Run "APICircle: Unlock Vault" first.`,
    );
    this.name = 'VaultLockedError';
  }
}

export class VaultCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultCryptoError';
  }
}

/** Snapshot returned to UI consumers describing a workspace's lock state. */
export interface VaultStateSnapshot {
  workspaceId: string;
  unlocked: boolean;
  /** Unix-ms timestamp of last activity. `null` when locked. */
  lastActivityAt: number | null;
  /** Minutes until auto-lock fires. `null` when auto-lock disabled or locked. */
  remainingMinutes: number | null;
}

/** A change event for downstream subscribers (EnvironmentView, status bar). */
export type VaultChangeReason = 'unlocked' | 'locked' | 'auto-locked' | 'config-changed';

interface VaultEntry {
  workspaceId: string;
  key: CryptoKey;
  /**
   * The `verifier` field of the SecretCryptoMeta blob the cached key was
   * derived from. Audit-R2-G3: used by `isUnlockedAgainst(blob)` to detect
   * "blob rotated externally → cached key is stale" — without this, a Git
   * pull bringing in a new blob would leave the cached key reporting
   * isUnlocked=true while every decrypt downstream fails opaquely.
   */
  derivedFromVerifier: string;
  /** unix-ms; refreshed by `touch()`. */
  lastActivityAt: number;
  /** Active setTimeout handle. `null` when auto-lock disabled. */
  timer: ReturnType<typeof setTimeout> | null;
}

/** Injectable clock + scheduler — lets tests pin the timer without sleeps. */
export interface VaultManagerDeps {
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  /** Hook fired whenever lock state changes (incl. auto-lock). */
  log?: (msg: string) => void;
}

export class VsCodeVaultManager {
  private readonly entries = new Map<string, VaultEntry>();
  private readonly listeners: Array<(workspaceId: string, reason: VaultChangeReason) => void> = [];
  private autoLockMinutes = 30; // mirrors the default in package.json contributes.configuration
  private readonly now: () => number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly log: (msg: string) => void;

  constructor(deps: VaultManagerDeps = {}) {
    // P4 note: Date.now / setTimeout are injected so unit tests can pin
    // them. The vscode host wires the real globals; this class is host-
    // agnostic.
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimeout ?? setTimeout;
    this.clearTimer = deps.clearTimeout ?? clearTimeout;
    this.log = deps.log ?? (() => undefined);
  }

  // ---------------------------------------------------------------------------
  // Initialisation / unlock
  // ---------------------------------------------------------------------------

  /**
   * Create a NEW vault for a workspace. Returns the SecretCryptoMeta blob to
   * persist via `applyMutation({kind:'secret.crypto.set'})`. The derived key
   * is cached in this manager so subsequent ops don't require a re-unlock.
   *
   * If the workspace already has a cached key, this still rotates it — the
   * caller is responsible for re-encrypting every payload first.
   *
   * The optional `iterations` override exists for tests; production callers
   * MUST omit it so the OWASP-floor count from passphraseKey.ts applies.
   */
  async initialize(
    workspaceId: string,
    passphrase: string,
    iterations?: number,
  ): Promise<SecretCryptoMeta> {
    const { crypto: blob, key } = await initSecretCrypto(passphrase, iterations);
    this.installKey(workspaceId, key, 'unlocked', blob.verifier);
    return blob;
  }

  /**
   * Unlock an existing vault. Returns `{ ok: true }` on success, `{ ok:
   * false, reason }` on wrong-passphrase / corrupt-blob / unsupported-kdf.
   * Errors are surfaced as a typed result (not thrown) so the command layer
   * can choose the right UX without sniffing exception messages.
   */
  async unlock(
    workspaceId: string,
    passphrase: string,
    blob: SecretCryptoMeta,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const result = await unlockSecretCrypto(passphrase, blob);
    if (!result.ok) return result;
    this.installKey(workspaceId, result.key, 'unlocked', blob.verifier);
    return { ok: true };
  }

  /** Manually lock a single workspace. */
  lock(workspaceId: string): void {
    const entry = this.entries.get(workspaceId);
    if (!entry) return;
    if (entry.timer) this.clearTimer(entry.timer);
    this.entries.delete(workspaceId);
    this.fire(workspaceId, 'locked');
  }

  /** Lock every workspace. Wired to `apicircle.lockVault` (no node arg) and
   * to extension `deactivate`. */
  lockAll(): void {
    const ids = [...this.entries.keys()];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry?.timer) this.clearTimer(entry.timer);
    }
    this.entries.clear();
    for (const id of ids) this.fire(id, 'locked');
  }

  // ---------------------------------------------------------------------------
  // Crypto ops
  // ---------------------------------------------------------------------------

  /** Encrypt + serialise to the `enc:v1:<iv>:<ct>` wire form. */
  async encryptValue(workspaceId: string, plaintext: string): Promise<string> {
    const entry = this.requireUnlocked(workspaceId);
    const payload = await encryptString(plaintext, entry.key);
    this.touchInternal(entry);
    return serializePayload(payload);
  }

  /**
   * Decrypt an `enc:v1:<iv>:<ct>` string. Throws `VaultLockedError` if the
   * workspace is locked, `VaultCryptoError` on a malformed string or
   * tampered ciphertext (the inner decrypt throws a generic "bad tag"
   * DOMException that we wrap to a typed error).
   */
  async decryptValue(workspaceId: string, wire: string): Promise<string> {
    const entry = this.requireUnlocked(workspaceId);
    const payload = tryParsePayload(wire);
    if (!payload) {
      throw new VaultCryptoError(
        'Value is not a valid encrypted payload (expected "enc:v1:<iv>:<ciphertext>").',
      );
    }
    let plain: string;
    try {
      plain = await decryptString(payload, entry.key);
    } catch (err) {
      throw new VaultCryptoError(
        `Decryption failed — ciphertext may be tampered or encrypted under a different passphrase. (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    this.touchInternal(entry);
    return plain;
  }

  // ---------------------------------------------------------------------------
  // Observation API
  // ---------------------------------------------------------------------------

  isUnlocked(workspaceId: string): boolean {
    return this.entries.has(workspaceId);
  }

  /**
   * Audit-R2-G15: snapshot of currently-unlocked workspace ids. Used by
   * `lockVaultCommand` to disambiguate "locked N vaults" vs "nothing to
   * lock" in the toast.
   */
  unlockedWorkspaceIds(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Audit-R2-G3: liveness check against the workspace's on-disk
   * `SecretCryptoMeta`. Returns `true` only when the workspace is unlocked
   * AND the cached key was derived from the blob carrying this exact
   * verifier. After a teammate rotates the passphrase + Git pull, the
   * blob's verifier changes — this returns `false`, prompting the command
   * layer to drop the stale key and re-prompt for the new passphrase.
   */
  isUnlockedAgainst(workspaceId: string, blob: SecretCryptoMeta | null | undefined): boolean {
    if (!blob) return false;
    const entry = this.entries.get(workspaceId);
    if (!entry) return false;
    return entry.derivedFromVerifier === blob.verifier;
  }

  snapshot(workspaceId: string): VaultStateSnapshot {
    const entry = this.entries.get(workspaceId);
    if (!entry) {
      return { workspaceId, unlocked: false, lastActivityAt: null, remainingMinutes: null };
    }
    let remaining: number | null = null;
    if (this.autoLockMinutes > 0) {
      const totalMs = this.autoLockMinutes * 60_000;
      const idleMs = this.now() - entry.lastActivityAt;
      remaining = Math.max(0, (totalMs - idleMs) / 60_000);
    }
    return {
      workspaceId,
      unlocked: true,
      lastActivityAt: entry.lastActivityAt,
      remainingMinutes: remaining,
    };
  }

  /** Subscribe to lock-state changes. Returns a disposable. */
  onDidChange(listener: (workspaceId: string, reason: VaultChangeReason) => void): {
    dispose: () => void;
  } {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const i = this.listeners.indexOf(listener);
        if (i >= 0) this.listeners.splice(i, 1);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Settings + activity
  // ---------------------------------------------------------------------------

  /**
   * Reconfigure auto-lock minutes. Re-arms every active timer with the new
   * value (or cancels them when `minutes === 0`). Negative values are
   * coerced to 0 (auto-lock disabled).
   */
  setAutoLockMinutes(minutes: number): void {
    const sane = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
    if (sane === this.autoLockMinutes) return;
    this.autoLockMinutes = sane;
    for (const entry of this.entries.values()) {
      if (entry.timer) this.clearTimer(entry.timer);
      entry.timer = this.armTimer(entry);
      entry.lastActivityAt = this.now();
    }
    // Fire a single config-changed event per known workspace so the status
    // bar can re-render its "auto-lock in N min" hint.
    for (const id of this.entries.keys()) this.fire(id, 'config-changed');
  }

  /** Touch the activity timestamp for the active workspace. Wired to the
   * "any user gesture" path in extension.ts so the auto-lock timer resets
   * while the user is actively working. */
  touch(workspaceId: string): void {
    const entry = this.entries.get(workspaceId);
    if (!entry) return;
    this.touchInternal(entry);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private requireUnlocked(workspaceId: string): VaultEntry {
    const entry = this.entries.get(workspaceId);
    if (!entry) throw new VaultLockedError(workspaceId);
    return entry;
  }

  private installKey(
    workspaceId: string,
    key: CryptoKey,
    reason: VaultChangeReason,
    derivedFromVerifier: string,
  ): void {
    const existing = this.entries.get(workspaceId);
    if (existing?.timer) this.clearTimer(existing.timer);
    const entry: VaultEntry = {
      workspaceId,
      key,
      derivedFromVerifier,
      lastActivityAt: this.now(),
      timer: null,
    };
    entry.timer = this.armTimer(entry);
    this.entries.set(workspaceId, entry);
    this.fire(workspaceId, reason);
  }

  private armTimer(entry: VaultEntry): ReturnType<typeof setTimeout> | null {
    if (this.autoLockMinutes <= 0) return null;
    const ms = this.autoLockMinutes * 60_000;
    return this.setTimer(() => {
      const current = this.entries.get(entry.workspaceId);
      // Guard: the entry may have been replaced or removed since the
      // timer was armed.
      if (!current || current !== entry) return;
      this.entries.delete(entry.workspaceId);
      this.log(
        `[vault] auto-locked workspace ${entry.workspaceId} after ${this.autoLockMinutes}m of inactivity`,
      );
      this.fire(entry.workspaceId, 'auto-locked');
    }, ms);
  }

  private touchInternal(entry: VaultEntry): void {
    entry.lastActivityAt = this.now();
    if (entry.timer) this.clearTimer(entry.timer);
    entry.timer = this.armTimer(entry);
  }

  private fire(workspaceId: string, reason: VaultChangeReason): void {
    // Snapshot to survive dispose-during-fire (mirrors VsCodeMockController
    // pattern in P3R3-G1).
    for (const listener of [...this.listeners]) {
      try {
        listener(workspaceId, reason);
      } catch (err) {
        this.log(`[vault] listener threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
