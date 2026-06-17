import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as YAML from 'yaml';
import * as TOML from 'smol-toml';
import { buildSnippetVariants, resolveAiClientConfigPath } from '@apicircle/mcp-server';

// =============================================================================
// Phase 8 — multi-AI-client MCP config installer.
//
// Extends P6's `copilotMcpInstall.ts` model from workspace-local
// `.vscode/mcp.json` to USER-LEVEL config files of each supported AI client:
//
//   - claude-desktop  → ~/Library/.../Claude/claude_desktop_config.json (Mac)
//                       %APPDATA%/Claude/claude_desktop_config.json   (Win)
//                       ~/.config/Claude/claude_desktop_config.json   (Linux)
//   - claude-code     → ~/.claude/mcp.json
//   - cursor          → ~/.cursor/mcp.json
//   - windsurf        → ~/.codeium/windsurf/mcp_config.json
//   - zed             → ~/.config/zed/settings.json
//
// Schema variants supported:
//   - 'mcpServers'     — the standard envelope used by 4 of 5 clients.
//                        Adds/updates a top-level `mcpServers.apicircle` key.
//   - 'context_servers' — Zed's variant. Adds/updates a top-level
//                         `context_servers.apicircle` key with the SAME shape.
//                         (Zed's `command` field is a string at top level
//                         not nested under `command: { path, args }` — newer
//                         spec migrated to flat shape, matches our writer.)
//
// Deferred to Phase 9+:
//   - continue (config.yaml — needs a YAML writer, not JSON)
//   - cline (VS Code-resident; use the P6 `.vscode/mcp.json` install path)
//
// Security model:
//   - Config paths are NOT user-configurable per client. They come from
//     `resolveAiClientConfigPath()` which is hard-coded against the OS
//     convention for each client. A malicious workspace cannot redirect
//     writes elsewhere — the path is fixed by client ID, not by setting.
//   - The setting `apicircle.mcp.autoConfigureClients` is only an
//     allowlist of WHICH clients to target; it cannot change WHERE we
//     write for a given client.
//   - We refuse to write outside the user's home directory (defense in
//     depth — `resolveAiClientConfigPath` already produces paths under
//     homedir, but we re-assert).
//   - Symlink follow-through: `fs.writeFileSync` follows symlinks. The
//     target file's containment is checked via `fs.realpathSync` when
//     the file exists; a malicious symlink at `~/.cursor/mcp.json`
//     pointing outside homedir would be rejected.
// =============================================================================

/** Subset of `AiClient` the auto-install command can target. Phase 8 shipped
 *  5 standard-schema clients + Zed; Phase 11 adds Continue (YAML schema). */
export type InstallableClient =
  | 'claude-desktop'
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'windsurf'
  | 'zed'
  | 'continue';

/** Human-readable label per client — used by the McpView + toast messages. */
export const CLIENT_LABELS: Record<InstallableClient, string> = {
  'claude-desktop': 'Claude Desktop',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  zed: 'Zed',
  continue: 'Continue',
};

/** Per-client config schema:
 *   - 'mcpServers' (JSON) — standard envelope, used by 4 clients.
 *   - 'context_servers' (JSON) — Zed's variant.
 *   - 'mcpServers-yaml' — Phase 11: Continue's YAML config with top-level
 *     `mcpServers` map. Same shape as standard but serialised as YAML so the
 *     rest of Continue's config (models, name, version) is preserved.
 */
type SchemaVariant = 'mcpServers' | 'context_servers' | 'mcpServers-yaml' | 'mcp_servers-toml';

const SCHEMA_VARIANTS: Record<InstallableClient, SchemaVariant> = {
  'claude-desktop': 'mcpServers',
  'claude-code': 'mcpServers',
  codex: 'mcp_servers-toml',
  cursor: 'mcpServers',
  windsurf: 'mcpServers',
  zed: 'context_servers',
  continue: 'mcpServers-yaml',
};

export const INSTALLABLE_CLIENTS: readonly InstallableClient[] = [
  'claude-desktop',
  'claude-code',
  'codex',
  'cursor',
  'windsurf',
  'zed',
  'continue',
] as const;

type InstallOutcome = 'created' | 'updated' | 'unchanged';

export interface ClientInstallResult {
  client: InstallableClient;
  outcome: InstallOutcome;
  path: string;
}

export interface ClientInstallOptions {
  client: InstallableClient;
  /** Binary to launch (from `apicircle.mcp.binaryPath`). */
  binary: string;
  /** Active workspace's `.apicircle/` directory. */
  apicircleDir: string;
  /** Env override — tests inject a virtual homedir + platform; production passes os.homedir() + process.platform. */
  env?: ConfigPathEnv;
  /** Internal — defaults to "apicircle". */
  entryName?: string;
}

interface ConfigPathEnv {
  homedir: string;
  platform: NodeJS.Platform;
  appdata?: string;
}

const DEFAULT_ENTRY_NAME = 'apicircle';

/**
 * P8-1a-G1 (SECURITY): refuse to write outside the user's home directory.
 * The standard `resolveAiClientConfigPath` already produces homedir-anchored
 * paths, but we re-assert after follow-symlink resolution to guard against
 * a malicious symlink at e.g. `~/.cursor/mcp.json` pointing at
 * `/etc/sudoers`.
 *
 * Resolves the realpath of the parent directory (the file itself may not
 * exist) and asserts containment.
 */
export class UnsafeClientConfigPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeClientConfigPathError';
  }
}

function assertContainedInHome(fullPath: string, homedir: string): void {
  const realHome = fs.existsSync(homedir) ? fs.realpathSync(homedir) : homedir;
  // Compute the deepest existing ancestor — realpathSync only works on
  // existing paths, so walk up until we find one.
  let probe = path.dirname(fullPath);
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) {
    probe = path.dirname(probe);
  }
  const realParent = fs.existsSync(probe) ? fs.realpathSync(probe) : probe;
  const normalizedHome = realHome + path.sep;
  if (realParent !== realHome && !realParent.startsWith(normalizedHome)) {
    throw new UnsafeClientConfigPathError(
      `Refusing to write ${fullPath}: realpath of nearest existing ancestor "${realParent}" is outside the user home directory "${realHome}". This typically means a malicious symlink — verify the AI client's config directory before retrying.`,
    );
  }
}

/**
 * Resolve the config-file path for a given client + env. Returns null if the
 * client has no fixed location (clients listed in `AI_CLIENTS` but not in
 * `INSTALLABLE_CLIENTS`).
 */
export function resolveInstallPath(client: InstallableClient, env: ConfigPathEnv): string {
  const resolved = resolveAiClientConfigPath(client, env);
  if (!resolved) {
    throw new Error(
      `mcpClientInstall: resolveAiClientConfigPath returned null for "${client}". The client should always have a fixed location — check @apicircle/mcp-server config/snippets.ts.`,
    );
  }
  return resolved;
}

/** Build the apicircle server entry from the shared snippet builder. */
function buildDesiredEntry(
  binary: string,
  apicircleDir: string,
): { command: string; args?: string[]; env?: Record<string, string> } {
  // Use forward-slash variant unconditionally — JSON-encoded backslashes are
  // ugly + the user might commit the file to dotfiles repo cross-platform.
  const variants = buildSnippetVariants('generic', binary, apicircleDir);
  const parsed = JSON.parse(variants.forwardSlash) as {
    mcpServers: {
      apicircle: { command: string; args?: string[]; env?: Record<string, string> };
    };
  };
  return parsed.mcpServers.apicircle;
}

function entriesEqual(
  a: { command: string; args?: string[]; env?: Record<string, string> },
  b: { command: string; args?: string[]; env?: Record<string, string> },
): boolean {
  if (a.command !== b.command) return false;
  const aArgs = a.args ?? [];
  const bArgs = b.args ?? [];
  if (aArgs.length !== bArgs.length) return false;
  for (let i = 0; i < aArgs.length; i++) {
    if (aArgs[i] !== bArgs[i]) return false;
  }
  const aEnv = a.env ?? {};
  const bEnv = b.env ?? {};
  const aKeys = Object.keys(aEnv);
  const bKeys = Object.keys(bEnv);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (aEnv[k] !== bEnv[k]) return false;
  }
  return true;
}

/**
 * Apply the install/update operation for a single client. Idempotent.
 *
 * - Missing file → create with just the apicircle entry under the schema-
 *   appropriate top-level key.
 * - Existing file, malformed JSON → treated as "create fresh" rather than
 *   throwing. Real-world AI clients often have a default-empty `{}` or even
 *   YAML-with-frontmatter; if we can't parse it as JSON we err on the side
 *   of not destroying the user's data — but we DO overwrite if the entry is
 *   wrong.
 * - Existing file, parsed → preserves every foreign key (other MCP server
 *   entries, top-level settings, etc.); only touches `<schemaKey>.apicircle`.
 * - Current entry matches what we'd write → no-op (return 'unchanged').
 */
export function installClientMcpConfig(opts: ClientInstallOptions): ClientInstallResult {
  const env: ConfigPathEnv = opts.env ?? {
    homedir: os.homedir(),
    platform: process.platform,
    appdata: process.env.APPDATA,
  };
  const entryName = opts.entryName ?? DEFAULT_ENTRY_NAME;
  const variant: SchemaVariant = SCHEMA_VARIANTS[opts.client];
  const schemaKey: 'mcpServers' | 'context_servers' | 'mcp_servers' =
    variant === 'context_servers'
      ? 'context_servers'
      : variant === 'mcp_servers-toml'
        ? 'mcp_servers'
        : 'mcpServers';
  const fullPath = resolveInstallPath(opts.client, env);

  // P8-1a-G1: guard against symlink escapes after we know the target path.
  assertContainedInHome(fullPath, env.homedir);

  const desired = buildDesiredEntry(opts.binary, opts.apicircleDir);

  if (!fs.existsSync(fullPath)) {
    const seeded = { [schemaKey]: { [entryName]: desired } };
    writeConfigFile(fullPath, seeded, variant);
    return { client: opts.client, outcome: 'created', path: fullPath };
  }

  const existing = readConfigFile(fullPath, variant);
  const serversBlock = (existing[schemaKey] as Record<string, typeof desired> | undefined) ?? {};
  const current = serversBlock[entryName];
  if (current !== undefined && entriesEqual(current, desired)) {
    return { client: opts.client, outcome: 'unchanged', path: fullPath };
  }

  const nextServers = { ...serversBlock, [entryName]: desired };
  const next = { ...existing, [schemaKey]: nextServers };
  writeConfigFile(fullPath, next, variant);
  return {
    client: opts.client,
    outcome: current === undefined ? 'created' : 'updated',
    path: fullPath,
  };
}

/** Snapshot install state for a single client — no mutation. */
export function detectClientMcpConfigState(opts: {
  client: InstallableClient;
  binary: string;
  apicircleDir: string;
  env?: ConfigPathEnv;
  entryName?: string;
}): 'absent' | 'installed-current' | 'installed-stale' {
  const env: ConfigPathEnv = opts.env ?? {
    homedir: os.homedir(),
    platform: process.platform,
    appdata: process.env.APPDATA,
  };
  const entryName = opts.entryName ?? DEFAULT_ENTRY_NAME;
  const variant: SchemaVariant = SCHEMA_VARIANTS[opts.client];
  const schemaKey: 'mcpServers' | 'context_servers' | 'mcp_servers' =
    variant === 'context_servers'
      ? 'context_servers'
      : variant === 'mcp_servers-toml'
        ? 'mcp_servers'
        : 'mcpServers';
  let fullPath: string;
  try {
    fullPath = resolveInstallPath(opts.client, env);
    assertContainedInHome(fullPath, env.homedir);
  } catch {
    // Path resolution failed (e.g. symlink violation) — surface as 'absent'
    // so the tree row stays clean. Install attempt will throw the same.
    return 'absent';
  }
  if (!fs.existsSync(fullPath)) return 'absent';
  try {
    const parsed = readConfigFile(fullPath, variant);
    const serversBlock = parsed[schemaKey] as Record<string, McpEntry> | undefined;
    if (!serversBlock) return 'absent';
    const current = serversBlock[entryName];
    if (!current) return 'absent';
    const desired = buildDesiredEntry(opts.binary, opts.apicircleDir);
    return entriesEqual(current, desired) ? 'installed-current' : 'installed-stale';
  } catch {
    return 'absent';
  }
}

// ---------------------------------------------------------------------------
// Format-aware read/write — Phase 11 added YAML support for Continue.
// ---------------------------------------------------------------------------

/**
 * Tolerantly read + parse a client config file. Returns an empty object on
 * any parse failure — we err on "create fresh" rather than throwing because
 * AI clients sometimes ship default-empty files of either format. The
 * caller's merge logic still preserves foreign keys when the file parses.
 */
function readConfigFile(filePath: string, variant: SchemaVariant): Record<string, unknown> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }
  if (variant === 'mcp_servers-toml') {
    try {
      const parsed: unknown = TOML.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to empty
    }
    return {};
  }
  if (variant === 'mcpServers-yaml') {
    try {
      const parsed: unknown = YAML.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to empty
    }
    return {};
  }
  // JSON variants:
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

/** Serialise + write the config file in the right format for the variant. */
function writeConfigFile(
  filePath: string,
  value: Record<string, unknown>,
  variant: SchemaVariant,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (variant === 'mcp_servers-toml') {
    fs.writeFileSync(filePath, TOML.stringify(value));
    return;
  }
  if (variant === 'mcpServers-yaml') {
    fs.writeFileSync(filePath, YAML.stringify(value));
    return;
  }
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

/** Shape of a single MCP server entry — used internally + by detect probe. */
type McpEntry = { command: string; args?: string[]; env?: Record<string, string> };

/**
 * Bulk-install across a list of clients. Each client install is independent —
 * one failure doesn't abort the others. Returns a per-client result array
 * (with `outcome === 'unchanged'` on no-op + an `error` field on failure).
 */
export interface BulkInstallReport {
  results: Array<
    | ClientInstallResult
    | { client: InstallableClient; outcome: 'error'; path: string | null; error: string }
  >;
  summary: {
    created: number;
    updated: number;
    unchanged: number;
    error: number;
  };
}

export function installMcpForClients(
  clients: readonly InstallableClient[],
  opts: Omit<ClientInstallOptions, 'client'>,
): BulkInstallReport {
  const results: BulkInstallReport['results'] = [];
  const summary = { created: 0, updated: 0, unchanged: 0, error: 0 };
  for (const client of clients) {
    try {
      const r = installClientMcpConfig({ ...opts, client });
      results.push(r);
      summary[r.outcome] += 1;
    } catch (err) {
      const env: ConfigPathEnv = opts.env ?? {
        homedir: os.homedir(),
        platform: process.platform,
        appdata: process.env.APPDATA,
      };
      let resolvedPath: string | null = null;
      try {
        resolvedPath = resolveInstallPath(client, env);
      } catch {
        // ignore — path itself failed to resolve
      }
      results.push({
        client,
        outcome: 'error',
        path: resolvedPath,
        error: err instanceof Error ? err.message : String(err),
      });
      summary.error += 1;
    }
  }
  return { results, summary };
}
