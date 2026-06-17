import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildSnippetVariants } from '@apicircle/mcp-server';

// =============================================================================
// `.vscode/mcp.json` writer — VS Code 1.86+ Copilot Chat (and any extension
// that reads workspace-local MCP config) auto-discovers MCP servers
// configured in this file. Phase 6 ships a one-click "Install for
// Copilot Chat" surface in the MCP view that writes/merges the apicircle
// entry idempotently.
//
// Idempotence contract:
//   • If `.vscode/mcp.json` doesn't exist → create it with just the
//     apicircle entry.
//   • If it exists with no `mcpServers` key → preserve whatever else is
//     there + add `mcpServers.apicircle`.
//   • If it has `mcpServers` with unrelated entries → preserve those +
//     add/update `apicircle` only.
//   • If it already has `mcpServers.apicircle` matching what we'd write
//     → no-op (return 'unchanged').
//   • If it has `mcpServers.apicircle` with stale args/path → update
//     just that entry (return 'updated').
//
// Cross-platform note: VS Code's `.vscode/mcp.json` accepts both
// forward-slash and escaped paths in the `args` array. We always emit
// forward-slash form on Windows for readability — VS Code + Node both
// accept it.
// =============================================================================

/** P6R1-G1: not exported — `InstallResult.outcome` inlines to this union
 *  for consumers, so a named type at the module boundary just leaves
 *  an unused export. */
type InstallOutcome = 'created' | 'updated' | 'unchanged';

export interface InstallResult {
  outcome: InstallOutcome;
  /** Absolute path to the file that was created/updated/inspected. */
  path: string;
  /** What the file holds after the operation. Useful for tests + audits. */
  finalContent: McpConfigShape;
}

/** Minimal subset of `.vscode/mcp.json` the writer cares about. Other keys
 * (servers, inputs, etc. that future VS Code versions may add) are preserved
 * verbatim. */
export interface McpConfigShape {
  mcpServers?: Record<string, McpServerEntry>;
  /** Anything else the user has put in their config. */
  [extraKey: string]: unknown;
}

/** P6R1-G1: internal-only — consumers should reach for `McpConfigShape`
 *  which embeds this type via `mcpServers[k]`. */
interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface InstallOptions {
  /** Absolute path to the workspace folder (the parent of `.vscode/`). */
  workspaceFolder: string;
  /** Path inside the workspace folder where mcp.json lives. Default
   *  `.vscode/mcp.json` — overridable via `apicircle.mcp.workspaceConfigPath`
   *  for users with custom layouts. */
  relativeConfigPath?: string;
  /** Binary the apicircle entry should launch. Comes from
   *  `apicircle.mcp.binaryPath` setting. */
  binary: string;
  /** The `--workspace` arg value — typically the workspace's
   *  `.apicircle/` directory. */
  apicircleDir: string;
  /** Internal: override the entry key name. Defaults to "apicircle". */
  entryName?: string;
}

const DEFAULT_RELATIVE_PATH = '.vscode/mcp.json';
const DEFAULT_ENTRY_NAME = 'apicircle';

/**
 * P6R4-G2 (SECURITY): validate that the relative config path can't escape
 * the workspace folder. A malicious `.vscode/settings.json` committed to
 * Git could set `apicircle.mcp.workspaceConfigPath` to `../../../tmp/evil.json`
 * and an unsuspecting user clicking "Install" would write outside the
 * workspace root.
 *
 * Resolves the path against the workspace folder and confirms the result
 * is contained. Rejects absolute paths outright (the setting is documented
 * as relative). Throws on violation so the command layer can surface a
 * clear error toast.
 */
export class UnsafeConfigPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeConfigPathError';
  }
}

export function assertSafeRelativeConfigPath(
  workspaceFolder: string,
  relativeConfigPath: string,
): string {
  if (path.isAbsolute(relativeConfigPath)) {
    throw new UnsafeConfigPathError(
      `apicircle.mcp.workspaceConfigPath must be RELATIVE to the workspace folder; got an absolute path "${relativeConfigPath}". Edit your workspace settings to use a path like ".vscode/mcp.json".`,
    );
  }
  const resolved = path.resolve(workspaceFolder, relativeConfigPath);
  // Normalize both sides for the prefix check — `path.resolve` produces
  // OS-native separators; the comparison is purely a containment guard.
  const normalizedFolder = path.resolve(workspaceFolder) + path.sep;
  if (!resolved.startsWith(normalizedFolder) && resolved !== path.resolve(workspaceFolder)) {
    throw new UnsafeConfigPathError(
      `apicircle.mcp.workspaceConfigPath "${relativeConfigPath}" resolves OUTSIDE the workspace folder ("${resolved}" is not under "${workspaceFolder}"). Refusing to write. This typically means a malicious or misconfigured workspace settings entry — verify .vscode/settings.json before retrying.`,
    );
  }
  return resolved;
}

/**
 * Apply the install/update operation. Idempotent.
 *
 * The returned `outcome` discriminates between three states so the
 * command layer can pick the right user-facing toast.
 */
export function installCopilotMcpConfig(opts: InstallOptions): InstallResult {
  const relativePath = opts.relativeConfigPath ?? DEFAULT_RELATIVE_PATH;
  const entryName = opts.entryName ?? DEFAULT_ENTRY_NAME;
  // P6R4-G2: path-traversal guard. Throws `UnsafeConfigPathError` if
  // the setting escapes the workspace root. The command layer catches
  // this and surfaces a clear toast.
  const fullPath = assertSafeRelativeConfigPath(opts.workspaceFolder, relativePath);

  // Compute what we want the apicircle entry to look like. We always use
  // the forward-slash workspace form (VS Code / Node accept both on
  // Windows; this matches what the snippet picker defaults to).
  const desired = buildDesiredEntry(opts.binary, opts.apicircleDir);

  // Empty/missing file → create with just the apicircle entry, but
  // formatted as a complete config object so future users can hand-edit.
  if (!fs.existsSync(fullPath)) {
    const seeded: McpConfigShape = { mcpServers: { [entryName]: desired } };
    writeFormattedJson(fullPath, seeded);
    return { outcome: 'created', path: fullPath, finalContent: seeded };
  }

  // Existing file → parse defensively. A malformed JSON file is treated
  // as "create fresh" rather than throwing — the caller (command layer)
  // surfaces a warning before destroying user content.
  let existing: McpConfigShape;
  try {
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as McpConfigShape;
    } else {
      // JSON parsed but isn't an object — treat as empty.
      existing = {};
    }
  } catch {
    existing = {};
  }

  const mcpServers: Record<string, McpServerEntry> = existing.mcpServers
    ? { ...existing.mcpServers }
    : {};

  const current = mcpServers[entryName];
  const isCurrent = current !== undefined && entriesEqual(current, desired);
  if (isCurrent) {
    return { outcome: 'unchanged', path: fullPath, finalContent: existing };
  }

  mcpServers[entryName] = desired;
  const next: McpConfigShape = { ...existing, mcpServers };
  writeFormattedJson(fullPath, next);
  return {
    outcome: current === undefined ? 'created' : 'updated',
    path: fullPath,
    finalContent: next,
  };
}

export interface UninstallOptions {
  /** Absolute path to the workspace folder (the parent of `.vscode/`). */
  workspaceFolder: string;
  /** Path inside the workspace folder where mcp.json lives. */
  relativeConfigPath?: string;
  /** Override the entry key name. Defaults to "apicircle". */
  entryName?: string;
}

export interface UninstallResult {
  /** 'removed' when the apicircle entry was present and stripped.
   *  'absent' when the file or entry didn't exist (idempotent no-op). */
  outcome: 'removed' | 'absent';
  /** Absolute path of the file inspected (whether or not it was rewritten). */
  path: string;
}

/**
 * Remove the apicircle entry from `.vscode/mcp.json`. Idempotent — calling it
 * on an already-clean file is a no-op. Foreign entries (other `mcpServers`
 * keys the user added by hand) are preserved verbatim. If removing the entry
 * leaves `mcpServers` empty, the key itself is stripped to keep diffs tidy.
 */
export function uninstallCopilotMcpConfig(opts: UninstallOptions): UninstallResult {
  const relativePath = opts.relativeConfigPath ?? DEFAULT_RELATIVE_PATH;
  const entryName = opts.entryName ?? DEFAULT_ENTRY_NAME;
  const fullPath = assertSafeRelativeConfigPath(opts.workspaceFolder, relativePath);
  if (!fs.existsSync(fullPath)) return { outcome: 'absent', path: fullPath };

  let existing: McpConfigShape;
  try {
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { outcome: 'absent', path: fullPath };
    }
    existing = parsed as McpConfigShape;
  } catch {
    return { outcome: 'absent', path: fullPath };
  }

  const mcpServers = existing.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object' || !(entryName in mcpServers)) {
    return { outcome: 'absent', path: fullPath };
  }
  const nextServers = { ...mcpServers };
  delete nextServers[entryName];
  let next: McpConfigShape;
  if (Object.keys(nextServers).length === 0) {
    const { mcpServers: _omitted, ...rest } = existing;
    void _omitted;
    next = rest;
  } else {
    next = { ...existing, mcpServers: nextServers };
  }
  writeFormattedJson(fullPath, next);
  return { outcome: 'removed', path: fullPath };
}

/** Snapshot of the install state for the McpView's "Install / Installed"
 * tagging. Doesn't mutate anything. */
export function detectCopilotMcpConfigState(opts: {
  workspaceFolder: string;
  relativeConfigPath?: string;
  binary: string;
  apicircleDir: string;
  entryName?: string;
}): 'absent' | 'installed-current' | 'installed-stale' {
  const relativePath = opts.relativeConfigPath ?? DEFAULT_RELATIVE_PATH;
  const entryName = opts.entryName ?? DEFAULT_ENTRY_NAME;
  // P6R4-G2: the probe also runs the path-safety check, but it CATCHES
  // the error and returns 'absent'. A malicious setting shouldn't crash
  // the McpView's tree render — surfacing the error happens at install
  // time. This keeps the probe pure (no thrown exceptions).
  let fullPath: string;
  try {
    fullPath = assertSafeRelativeConfigPath(opts.workspaceFolder, relativePath);
  } catch {
    return 'absent';
  }
  if (!fs.existsSync(fullPath)) return 'absent';
  try {
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'absent';
    }
    const config = parsed as McpConfigShape;
    const current = config.mcpServers?.[entryName];
    if (!current) return 'absent';
    const desired = buildDesiredEntry(opts.binary, opts.apicircleDir);
    return entriesEqual(current, desired) ? 'installed-current' : 'installed-stale';
  } catch {
    return 'absent';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildDesiredEntry(binary: string, apicircleDir: string): McpServerEntry {
  // Reuse the shared snippet builder so the JSON SHAPE matches exactly
  // what the desktop + VS Code copy commands emit. We extract just the
  // `apicircle` server entry from the snippet's `mcpServers.apicircle`
  // node — the builder emits the full wrapper, we need just the inner
  // value for our mcpServers map.
  //
  // Always use the forward-slash variant on Windows: `.vscode/mcp.json`
  // is committed to Git, so JSON-escaped backslashes would leak Windows
  // paths into a teammate's macOS/Linux clone.
  const variants = buildSnippetVariants('generic', binary, apicircleDir);
  const parsed = JSON.parse(variants.forwardSlash) as {
    mcpServers: { apicircle: McpServerEntry };
  };
  return parsed.mcpServers.apicircle;
}

function entriesEqual(a: McpServerEntry, b: McpServerEntry): boolean {
  if (a.command !== b.command) return false;
  if (!arrayEqual(a.args ?? [], b.args ?? [])) return false;
  return envEqual(a.env ?? {}, b.env ?? {});
}

function arrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function envEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function writeFormattedJson(filePath: string, value: McpConfigShape): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // 2-space indent + trailing newline match VS Code's settings-writer
  // convention. Easier for users to diff against committed config.
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}
