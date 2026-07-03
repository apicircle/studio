import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as YAML from 'yaml';
import * as TOML from 'smol-toml';
import { buildSnippetVariants, resolveAiClientConfigPath } from '@apicircle/mcp-server';

// =============================================================================
// Desktop MCP config installer — writes the apicircle MCP entry into each
// AI client's config file so the user doesn't have to copy-paste manually.
//
// Adapted from `apps/vscode/src/host/mcpClientInstall.ts` — same format-aware
// read/write, same security model (homedir containment, symlink guard), same
// 7-client coverage.
// =============================================================================

export type InstallableClient =
  | 'claude-desktop'
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'windsurf'
  | 'zed'
  | 'continue';

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

interface InstallResult {
  outcome: InstallOutcome;
  path: string;
}

type UninstallOutcome = 'removed' | 'absent';

interface UninstallResult {
  outcome: UninstallOutcome;
  path: string;
}

interface ConfigPathEnv {
  homedir: string;
  platform: NodeJS.Platform;
  appdata?: string;
}

type McpEntry = { command: string; args?: string[]; env?: Record<string, string> };

const ENTRY_NAME = 'apicircle';

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

function assertContainedInHome(fullPath: string, homedir: string): void {
  const realHome = fs.existsSync(homedir) ? fs.realpathSync(homedir) : homedir;
  let probe = path.dirname(fullPath);
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) {
    probe = path.dirname(probe);
  }
  const realParent = fs.existsSync(probe) ? fs.realpathSync(probe) : probe;
  const normalizedHome = realHome + path.sep;
  if (realParent !== realHome && !realParent.startsWith(normalizedHome)) {
    throw new Error(
      `Refusing to write ${fullPath}: resolved parent "${realParent}" is outside home "${realHome}".`,
    );
  }
}

function isInstallable(client: string): client is InstallableClient {
  return (INSTALLABLE_CLIENTS as readonly string[]).includes(client);
}

// ---------------------------------------------------------------------------
// Entry builder + comparison
// ---------------------------------------------------------------------------

function buildDesiredEntry(binary: string, apicircleDir: string): McpEntry {
  const variants = buildSnippetVariants('generic', binary, apicircleDir);
  const parsed = JSON.parse(variants.forwardSlash) as {
    mcpServers: { apicircle: McpEntry };
  };
  return parsed.mcpServers.apicircle;
}

function entriesEqual(a: McpEntry, b: McpEntry): boolean {
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

// ---------------------------------------------------------------------------
// Format-aware read/write
// ---------------------------------------------------------------------------

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
      /* fall through */
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
      /* fall through */
    }
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return {};
}

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function resolveEnv(): ConfigPathEnv {
  return { homedir: os.homedir(), platform: process.platform, appdata: process.env.APPDATA };
}

function schemaKey(variant: SchemaVariant): 'mcpServers' | 'context_servers' | 'mcp_servers' {
  if (variant === 'context_servers') return 'context_servers';
  if (variant === 'mcp_servers-toml') return 'mcp_servers';
  return 'mcpServers';
}

export function installClientConfig(
  client: string,
  binary: string,
  apicircleDir: string,
  envOverride?: ConfigPathEnv,
): InstallResult {
  if (!isInstallable(client)) {
    throw new Error(`Client "${client}" does not support direct config installation.`);
  }
  const env = envOverride ?? resolveEnv();
  const variant = SCHEMA_VARIANTS[client];
  const key = schemaKey(variant);
  const fullPath = resolveAiClientConfigPath(client, env);
  if (!fullPath) {
    throw new Error(`No fixed config path for client "${client}".`);
  }
  assertContainedInHome(fullPath, env.homedir);

  const desired = buildDesiredEntry(binary, apicircleDir);

  if (!fs.existsSync(fullPath)) {
    writeConfigFile(fullPath, { [key]: { [ENTRY_NAME]: desired } }, variant);
    return { outcome: 'created', path: fullPath };
  }

  const existing = readConfigFile(fullPath, variant);
  const block = (existing[key] as Record<string, McpEntry> | undefined) ?? {};
  const current = block[ENTRY_NAME];
  if (current !== undefined && entriesEqual(current, desired)) {
    return { outcome: 'unchanged', path: fullPath };
  }

  const next = { ...existing, [key]: { ...block, [ENTRY_NAME]: desired } };
  writeConfigFile(fullPath, next, variant);
  return { outcome: current === undefined ? 'created' : 'updated', path: fullPath };
}

/**
 * Remove the apicircle entry from a client's config file. The inverse of
 * {@link installClientConfig}. Idempotent — removing an absent entry is a
 * no-op that returns `'absent'`. Removal is keyed on the entry NAME, not its
 * contents, so a stale entry (pointing at an old workspace path) is removed
 * just the same. Foreign entries the user added by hand are preserved
 * verbatim; if stripping apicircle leaves the schema block empty, the block
 * key itself is dropped so the diff the user sees stays tidy. A malformed
 * config file is left untouched (returns `'absent'`) rather than rewritten —
 * we never destroy data we couldn't parse.
 */
export function uninstallClientConfig(
  client: string,
  envOverride?: ConfigPathEnv,
): UninstallResult {
  if (!isInstallable(client)) {
    throw new Error(`Client "${client}" does not support direct config installation.`);
  }
  const env = envOverride ?? resolveEnv();
  const variant = SCHEMA_VARIANTS[client];
  const key = schemaKey(variant);
  const fullPath = resolveAiClientConfigPath(client, env);
  if (!fullPath) {
    throw new Error(`No fixed config path for client "${client}".`);
  }
  assertContainedInHome(fullPath, env.homedir);

  if (!fs.existsSync(fullPath)) {
    return { outcome: 'absent', path: fullPath };
  }

  const existing = readConfigFile(fullPath, variant);
  const block = existing[key] as Record<string, McpEntry> | undefined;
  if (!block || typeof block !== 'object' || !(ENTRY_NAME in block)) {
    return { outcome: 'absent', path: fullPath };
  }

  const nextBlock = { ...block };
  delete nextBlock[ENTRY_NAME];

  const next: Record<string, unknown> = { ...existing };
  if (Object.keys(nextBlock).length === 0) {
    delete next[key];
  } else {
    next[key] = nextBlock;
  }
  writeConfigFile(fullPath, next, variant);
  return { outcome: 'removed', path: fullPath };
}

export function detectClientInstallState(
  client: string,
  binary: string,
  apicircleDir: string,
  envOverride?: ConfigPathEnv,
): 'absent' | 'installed-current' | 'installed-stale' {
  if (!isInstallable(client)) return 'absent';
  const env = envOverride ?? resolveEnv();
  const variant = SCHEMA_VARIANTS[client];
  const key = schemaKey(variant);
  let fullPath: string | null;
  try {
    fullPath = resolveAiClientConfigPath(client, env);
    if (!fullPath) return 'absent';
    assertContainedInHome(fullPath, env.homedir);
  } catch {
    return 'absent';
  }
  if (!fs.existsSync(fullPath)) return 'absent';
  try {
    const parsed = readConfigFile(fullPath, variant);
    const block = parsed[key] as Record<string, McpEntry> | undefined;
    if (!block) return 'absent';
    const current = block[ENTRY_NAME];
    if (!current) return 'absent';
    const desired = buildDesiredEntry(binary, apicircleDir);
    return entriesEqual(current, desired) ? 'installed-current' : 'installed-stale';
  } catch {
    return 'absent';
  }
}
