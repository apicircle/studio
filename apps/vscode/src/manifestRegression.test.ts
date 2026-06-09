import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// =============================================================================
// Regression assertions on package.json's contribution manifest.
//
// Audit-R2-G10: prevent the "Phase 4 — not yet implemented" placeholder
// labels from sneaking back into the secrets settings. Phase 4 wired both
// settings; the markdown banner shouldn't reappear unless a future phase
// rolls them back (and even then they should be re-labelled, not say
// "Phase 4").
//
// These tests read the on-disk package.json directly rather than the
// imported value, so a future contributor copy-pasting the old label
// gets caught at lint-time without needing a JSON-import rebuild.
// =============================================================================

// __dirname resolves to apps/vscode/src in the running test — one level up
// from src to reach apps/vscode/package.json.
const pkgPath = path.resolve(__dirname, '..', 'package.json');

interface Manifest {
  contributes: {
    commands: Array<{ command: string; title: string; category?: string }>;
    configuration: {
      properties: Record<string, { markdownDescription?: string; description?: string }>;
    };
  };
  activationEvents: string[];
}

function readManifest(): Manifest {
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Manifest;
}

describe('package.json manifest regression', () => {
  it('the two Phase 4 secrets settings exist and DO NOT carry the placeholder banner', () => {
    const pkg = readManifest();
    const auto = pkg.contributes.configuration.properties['apicircle.secrets.autoLockMinutes'];
    const clip =
      pkg.contributes.configuration.properties['apicircle.secrets.clipboardClearSeconds'];
    expect(auto).toBeDefined();
    expect(clip).toBeDefined();
    const autoText = (auto.markdownDescription ?? auto.description ?? '').toLowerCase();
    const clipText = (clip.markdownDescription ?? clip.description ?? '').toLowerCase();
    // The Phase 4 banner ("(Phase 4 — not yet implemented)") must NOT
    // be present any more.
    expect(autoText).not.toMatch(/phase 4.*not yet implemented/);
    expect(autoText).not.toMatch(/not yet implemented/);
    expect(clipText).not.toMatch(/phase 4.*not yet implemented/);
    expect(clipText).not.toMatch(/not yet implemented/);
  });

  it('every Phase 4 vault command is declared in contributes.commands', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    for (const id of [
      'apicircle.unlockVault',
      'apicircle.lockVault',
      'apicircle.setupVaultPassphrase',
      'apicircle.changeVaultPassphrase',
      'apicircle.openVaultEntry',
      'apicircle.showRunsChannel',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('every Phase 4 vault command has an onCommand activation event', () => {
    const pkg = readManifest();
    const events = new Set(pkg.activationEvents);
    for (const id of [
      'apicircle.unlockVault',
      'apicircle.lockVault',
      'apicircle.setupVaultPassphrase',
      'apicircle.changeVaultPassphrase',
      'apicircle.openVaultEntry',
      'apicircle.showRunsChannel',
    ]) {
      expect(events.has(`onCommand:${id}`)).toBe(true);
    }
  });

  // ----- P5 MCP host integration -----

  it('every Phase 5 MCP command is declared in contributes.commands', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    for (const id of [
      'apicircle.copyMcpConfig',
      'apicircle.openMcpConfigFile',
      'apicircle.openMcpConnectGuide',
      'apicircle.revealMcpBinaryInfo',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('every Phase 5 MCP command has an onCommand activation event', () => {
    const pkg = readManifest();
    const events = new Set(pkg.activationEvents);
    for (const id of [
      'apicircle.copyMcpConfig',
      'apicircle.openMcpConfigFile',
      'apicircle.openMcpConnectGuide',
      'apicircle.revealMcpBinaryInfo',
    ]) {
      expect(events.has(`onCommand:${id}`)).toBe(true);
    }
  });

  // ----- P6 Copilot Chat / VS Code MCP install -----

  it('apicircle.installCopilotMcpConfig is declared in contributes.commands', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    expect(ids.has('apicircle.installCopilotMcpConfig')).toBe(true);
  });

  it('apicircle.installCopilotMcpConfig has an onCommand activation event', () => {
    const pkg = readManifest();
    const events = new Set(pkg.activationEvents);
    expect(events.has('onCommand:apicircle.installCopilotMcpConfig')).toBe(true);
  });

  it('apicircle.mcp.workspaceConfigPath setting is declared with a non-empty default', () => {
    const pkg = readManifest();
    const setting = pkg.contributes.configuration.properties['apicircle.mcp.workspaceConfigPath'];
    expect(setting).toBeDefined();
    const def = (setting as unknown as { default?: unknown }).default;
    expect(typeof def).toBe('string');
    expect((def as string).length).toBeGreaterThan(0);
  });

  // ----- P8 multi-AI-client MCP install -----

  it('P8 commands (installMcpForClient, installMcpForAllClients, uninstallMcpForClient) are declared', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    expect(ids.has('apicircle.installMcpForClient')).toBe(true);
    expect(ids.has('apicircle.installMcpForAllClients')).toBe(true);
    expect(ids.has('apicircle.uninstallMcpForClient')).toBe(true);
  });

  it('P8 commands have onCommand activation events', () => {
    const pkg = readManifest();
    const events = new Set(pkg.activationEvents);
    expect(events.has('onCommand:apicircle.installMcpForClient')).toBe(true);
    expect(events.has('onCommand:apicircle.installMcpForAllClients')).toBe(true);
    expect(events.has('onCommand:apicircle.uninstallMcpForClient')).toBe(true);
  });

  // ----- P11 Mock endpoint editor + Continue auto-install -----

  it('P11 editMockEndpoint command + activation + mock-endpoint context menu', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    expect(ids.has('apicircle.editMockEndpoint')).toBe(true);
    const events = new Set(pkg.activationEvents);
    expect(events.has('onCommand:apicircle.editMockEndpoint')).toBe(true);
    // Context-menu entry on mock-endpoint items. The manifest reader
    // narrows the shape; reach into the parsed JSON directly for menus.
    const ctx = (
      pkg.contributes as {
        menus?: { 'view/item/context'?: Array<{ command?: string; when?: string }> };
      }
    ).menus?.['view/item/context'];
    expect(ctx).toBeDefined();
    const editMenuEntries = (ctx ?? []).filter((e) => e.command === 'apicircle.editMockEndpoint');
    expect(editMenuEntries.length).toBeGreaterThan(0);
    expect(editMenuEntries[0].when).toContain('viewItem == mock-endpoint');
  });

  it('P11 Continue is in apicircle.mcp.autoConfigureClients enum', () => {
    const pkg = readManifest();
    const setting = pkg.contributes.configuration.properties['apicircle.mcp.autoConfigureClients'];
    const items = (setting as { items?: { enum?: string[] } }).items;
    expect(items?.enum).toContain('continue');
  });

  // ----- P10 Embedded MCP host -----

  it('P10 embedded MCP host commands + settings are declared', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    expect(ids.has('apicircle.startEmbeddedMcp')).toBe(true);
    expect(ids.has('apicircle.stopEmbeddedMcp')).toBe(true);
    expect(ids.has('apicircle.restartEmbeddedMcp')).toBe(true);
    expect(ids.has('apicircle.copyEmbeddedMcpUrl')).toBe(true);

    const events = new Set(pkg.activationEvents);
    expect(events.has('onCommand:apicircle.startEmbeddedMcp')).toBe(true);
    expect(events.has('onCommand:apicircle.stopEmbeddedMcp')).toBe(true);
    expect(events.has('onCommand:apicircle.restartEmbeddedMcp')).toBe(true);
    expect(events.has('onCommand:apicircle.copyEmbeddedMcpUrl')).toBe(true);

    const props = pkg.contributes.configuration.properties;
    expect(props['apicircle.mcp.embeddedHost.enabled']).toBeDefined();
    expect((props['apicircle.mcp.embeddedHost.enabled'] as { type?: string }).type).toBe('boolean');
    expect((props['apicircle.mcp.embeddedHost.enabled'] as { default?: unknown }).default).toBe(
      false,
    );
    expect(props['apicircle.mcp.embeddedHost.port']).toBeDefined();
    expect((props['apicircle.mcp.embeddedHost.port'] as { type?: string }).type).toBe('number');
    expect(props['apicircle.mcp.embeddedHost.bindHost']).toBeDefined();
    expect((props['apicircle.mcp.embeddedHost.bindHost'] as { default?: unknown }).default).toBe(
      '127.0.0.1',
    );
  });

  // ----- P9 Plan Notebook + Test Controller -----

  it('P9 openPlanAsNotebook command + notebook contribution are declared', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    expect(ids.has('apicircle.openPlanAsNotebook')).toBe(true);
    const events = new Set(pkg.activationEvents);
    expect(events.has('onCommand:apicircle.openPlanAsNotebook')).toBe(true);
    expect(events.has('onNotebook:apicircle-plan')).toBe(true);
    const notebooks = (pkg.contributes as { notebooks?: Array<{ type: string }> }).notebooks;
    expect(notebooks).toBeDefined();
    const types = new Set(notebooks!.map((n) => n.type));
    expect(types.has('apicircle-plan')).toBe(true);
  });

  it('P8 vault remember-on-device is declared (command + setting + activation)', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    expect(ids.has('apicircle.forgetVaultOnDevice')).toBe(true);
    const events = new Set(pkg.activationEvents);
    expect(events.has('onCommand:apicircle.forgetVaultOnDevice')).toBe(true);
    const setting = pkg.contributes.configuration.properties['apicircle.secrets.rememberOnDevice'];
    expect(setting).toBeDefined();
    expect((setting as { type?: unknown }).type).toBe('boolean');
    expect((setting as { default?: unknown }).default).toBe(false);
  });

  it('apicircle.mcp.autoConfigureClients setting is declared as a typed string array', () => {
    const pkg = readManifest();
    const setting = pkg.contributes.configuration.properties['apicircle.mcp.autoConfigureClients'];
    expect(setting).toBeDefined();
    expect((setting as { type?: unknown }).type).toBe('array');
    const items = (setting as { items?: { type?: string; enum?: string[] } }).items;
    expect(items?.type).toBe('string');
    expect(items?.enum).toContain('claude-desktop');
    expect(items?.enum).toContain('cursor');
    expect(items?.enum).toContain('zed');
    expect(Array.isArray((setting as { default?: unknown }).default)).toBe(true);
  });

  it('no setting carries a "Phase 6 — not yet implemented" label (Phase 6 shipped)', () => {
    const pkg = readManifest();
    for (const [key, prop] of Object.entries(pkg.contributes.configuration.properties)) {
      const text = (prop.markdownDescription ?? prop.description ?? '').toLowerCase();
      expect(text, `${key} mentions "Phase 6 — not yet implemented"`).not.toMatch(
        /phase 6.*not yet implemented/,
      );
    }
  });

  it('no viewsWelcome entry claims "ships in Phase 6" (Phase 6 shipped)', () => {
    const pkg = readManifest() as Manifest & {
      contributes: { viewsWelcome?: Array<{ view: string; contents?: string }> };
    };
    for (const entry of pkg.contributes.viewsWelcome ?? []) {
      const text = (entry.contents ?? '').toLowerCase();
      expect(text, `viewsWelcome for ${entry.view} mentions "ships in Phase 6"`).not.toMatch(
        /ships in phase 6/,
      );
    }
  });

  it('apicircle.mcp.binaryPath setting is declared with a non-empty default', () => {
    const pkg = readManifest();
    const setting = pkg.contributes.configuration.properties['apicircle.mcp.binaryPath'];
    expect(setting).toBeDefined();
    // Hand-decode the typed default — manifest properties have an
    // `default` field but JSON's value-typing means we coerce loosely
    // and assert the shape rather than the precise typing.
    const def = (setting as unknown as { default?: unknown }).default;
    expect(typeof def).toBe('string');
    expect((def as string).length).toBeGreaterThan(0);
  });

  it('apicircle.mcp.binaryPath is NOT labelled as "not yet implemented"', () => {
    const pkg = readManifest();
    const setting = pkg.contributes.configuration.properties['apicircle.mcp.binaryPath'];
    const text = (setting.markdownDescription ?? setting.description ?? '').toLowerCase();
    expect(text).not.toMatch(/not yet implemented/);
    expect(text).not.toMatch(/phase 5.*not yet/);
  });

  // ----- XPhase-G6: cross-phase honesty guard -----
  //
  // Settings that are intentionally deferred beyond the current phase
  // must be labelled with the PHASE THEY ACTUALLY LAND IN (or "deferred"),
  // not a stale earlier-phase placeholder. Catches the kind of drift
  // where a Phase 4 deferred setting still says "Phase 4 — not yet
  // implemented" three phases after Phase 4 closed.

  it('no setting carries a "Phase 4 — not yet implemented" label (Phase 4 shipped)', () => {
    const pkg = readManifest();
    for (const [key, prop] of Object.entries(pkg.contributes.configuration.properties)) {
      const text = (prop.markdownDescription ?? prop.description ?? '').toLowerCase();
      expect(text, `${key} mentions "Phase 4 — not yet implemented"`).not.toMatch(
        /phase 4.*not yet implemented/,
      );
    }
  });

  it('no setting carries a "Phase 5 — not yet implemented" label (Phase 5 shipped)', () => {
    const pkg = readManifest();
    for (const [key, prop] of Object.entries(pkg.contributes.configuration.properties)) {
      const text = (prop.markdownDescription ?? prop.description ?? '').toLowerCase();
      expect(text, `${key} mentions "Phase 5 — not yet implemented"`).not.toMatch(
        /phase 5.*not yet implemented/,
      );
    }
  });

  // ----- XPhase-R3: viewsWelcome stale-phase guard -----
  //
  // viewsWelcome content shows when a view returns no children. After the
  // McpView fillout in Phase 5 it never displays — but the stale
  // "MCP integration ships in Phase 4" copy survived in the manifest
  // through 1 full Phase + 2 audit rounds. This guard catches the same
  // category of drift: every viewsWelcome `contents` field must not
  // reference a phase that has already shipped.

  interface ViewWelcomeEntry {
    view: string;
    contents?: string;
    when?: string;
  }

  it('no viewsWelcome entry claims "ships in Phase 4" (Phase 4 shipped)', () => {
    const pkg = readManifest() as Manifest & {
      contributes: { viewsWelcome?: ViewWelcomeEntry[] };
    };
    for (const entry of pkg.contributes.viewsWelcome ?? []) {
      const text = (entry.contents ?? '').toLowerCase();
      expect(text, `viewsWelcome for ${entry.view} mentions "ships in Phase 4"`).not.toMatch(
        /ships in phase 4/,
      );
    }
  });

  it('no viewsWelcome entry claims "ships in Phase 5" (Phase 5 shipped)', () => {
    const pkg = readManifest() as Manifest & {
      contributes: { viewsWelcome?: ViewWelcomeEntry[] };
    };
    for (const entry of pkg.contributes.viewsWelcome ?? []) {
      const text = (entry.contents ?? '').toLowerCase();
      expect(text, `viewsWelcome for ${entry.view} mentions "ships in Phase 5"`).not.toMatch(
        /ships in phase 5/,
      );
    }
  });
});
