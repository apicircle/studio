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
    languages?: Array<{ id: string; icon?: { light: string; dark: string } }>;
    yamlValidation?: Array<{ fileMatch: string; url: string }>;
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
      'apicircle.openMcpConfigFile',
      'apicircle.openMcpConnectGuide',
      'apicircle.revealMcpBinaryInfo',
    ]) {
      expect(events.has(`onCommand:${id}`)).toBe(true);
    }
  });

  // ----- Folder YAML schema registration -----

  it('yamlValidation is empty (compound extensions removed — language mode set programmatically)', () => {
    const pkg = readManifest();
    const entries = pkg.contributes.yamlValidation ?? [];
    expect(entries).toEqual([]);
  });

  it('apicircle-folder.schema.json exists on disk and parses as JSON with the expected shape', () => {
    const schemaPath = path.resolve(__dirname, '..', 'schemas', 'apicircle-folder.schema.json');
    expect(fs.existsSync(schemaPath)).toBe(true);
    const raw = fs.readFileSync(schemaPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      $schema?: string;
      required: string[];
      properties: { name?: { type: string }; auth?: { $ref?: string } };
      definitions?: { auth?: { properties?: { type?: { enum?: string[] } } } };
    };
    expect(parsed.required).toContain('name');
    expect(parsed.properties.name?.type).toBe('string');
    expect(parsed.properties.auth?.$ref).toMatch(/#\/definitions\/auth/);
    const authTypes = parsed.definitions?.auth?.properties?.type?.enum ?? [];
    // All 17 RequestAuth variants must be enumerated.
    expect(authTypes).toHaveLength(17);
    for (const expected of [
      'none',
      'inherit',
      'bearer',
      'basic',
      'api-key',
      'custom-header',
      'oauth2-client-credentials',
      'aws-sigv4',
      'jwt-bearer',
    ]) {
      expect(authTypes).toContain(expected);
    }
  });

  // ----- Language icon completeness -----

  it('every contributes.languages entry declares a light + dark icon', () => {
    const pkg = readManifest();
    const langs = pkg.contributes.languages ?? [];
    expect(langs.length).toBeGreaterThan(0);
    for (const lang of langs) {
      expect(lang.icon, `${lang.id} is missing an icon`).toBeDefined();
      expect(lang.icon!.light, `${lang.id} icon.light`).toMatch(/\.svg$/);
      expect(lang.icon!.dark, `${lang.id} icon.dark`).toMatch(/\.svg$/);
      const lightPath = path.resolve(__dirname, '..', lang.icon!.light);
      const darkPath = path.resolve(__dirname, '..', lang.icon!.dark);
      expect(fs.existsSync(lightPath), `${lang.id} light icon missing on disk: ${lightPath}`).toBe(
        true,
      );
      expect(fs.existsSync(darkPath), `${lang.id} dark icon missing on disk: ${darkPath}`).toBe(
        true,
      );
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

  // ----- New Request action icon + Editor welcome view gating -----
  //
  // Bug-fix follow-up: apicircle.newRequest used to render as raw text in
  // the Editor view's title bar because it lacked an icon, and the
  // Editor's welcome view said "Create New Workspace" / "Open Folder…"
  // even when a workspace was already detected. These tests pin both fixes.

  it('apicircle.newRequest declares an icon so the view-title menu renders as an icon, not text', () => {
    const pkg = readManifest();
    const cmd = pkg.contributes.commands.find((c) => c.command === 'apicircle.newRequest');
    expect(cmd).toBeDefined();
    expect((cmd as unknown as { icon?: string }).icon).toBe('$(add)');
  });

  it('post-launch UX: request template + add-section commands + Copilot uninstall are declared & activated', () => {
    // Three commands added in the first-week feedback sweep — the
    // template picker, the YAML CodeLens "+ Add section…" handler, and
    // the Copilot Chat uninstall affordance. All three need the
    // matching activation event so the lazy-load path triggers from the
    // CodeLens / TreeView click.
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    const events = new Set(pkg.activationEvents);
    for (const id of [
      'apicircle.newRequestFromTemplate',
      'apicircle.addRequestSection',
      'apicircle.switchRequestBodyType',
      'apicircle.switchRequestAuthType',
      'apicircle.pickBinaryAttachment',
      'apicircle.addFormDataRow',
      'apicircle.switchFormDataRowKind',
      'apicircle.pickFormDataRowFile',
      'apicircle.pickHeader',
      'apicircle.mapContextVarsFromJson',
      'apicircle.fetchOAuth2Token',
      'apicircle.addQueryRow',
      'apicircle.addCookieRow',
      'apicircle.addPathParamRow',
      'apicircle.addAssertionRow',
      'apicircle.addExtractionRow',
      'apicircle.addMockValidationRule',
      'apicircle.addMockMultiplier',
      'apicircle.switchMockResponseBodyType',
      'apicircle.setMockResponseStatus',
      'apicircle.addMockResponseRule',
      'apicircle.removeMockResponseRule',
      'apicircle.removeMockValidationRule',
      'apicircle.removeMockMultiplier',
      'apicircle.toggleMockRuleEnabled',
      'apicircle.addMockResponseHeader',
      'apicircle.openMockEndpointYaml',
      'apicircle.uninstallCopilotMcpConfig',
    ]) {
      expect(ids.has(id), `${id} missing from contributes.commands`).toBe(true);
      expect(events.has(`onCommand:${id}`), `${id} missing onCommand activation`).toBe(true);
    }
  });

  it('per-field mock validation commands are declared & activated', () => {
    // The ◆ Kind / ◆ Target / ◆ Value CodeLenses on requestValidation entries
    // drive these three commands; each needs a contributes.commands entry +
    // an onCommand activation so the lazy-load path fires from the lens click.
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    const events = new Set(pkg.activationEvents);
    for (const id of [
      'apicircle.setMockValidationKind',
      'apicircle.setMockValidationTarget',
      'apicircle.setMockValidationExpected',
    ]) {
      expect(ids.has(id), `${id} missing from contributes.commands`).toBe(true);
      expect(events.has(`onCommand:${id}`), `${id} missing onCommand activation`).toBe(true);
    }
  });

  it('collection-request field-editor commands are declared & activated', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    const events = new Set(pkg.activationEvents);
    for (const id of [
      'apicircle.setRequestMethodField',
      'apicircle.setRequestHeaderKeyField',
      'apicircle.setRequestHeaderValueField',
      'apicircle.setRequestTextField',
      'apicircle.setRequestAssertionKindField',
      'apicircle.setRequestAssertionOpField',
      'apicircle.setRequestExtractionSourceField',
    ]) {
      expect(ids.has(id), `${id} missing from contributes.commands`).toBe(true);
      expect(events.has(`onCommand:${id}`), `${id} missing onCommand activation`).toBe(true);
    }
  });

  it('requestSchema authoring commands are declared & activated', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    const events = new Set(pkg.activationEvents);
    for (const id of [
      'apicircle.addMockRequestSchema',
      'apicircle.addMockRequestSchemaParam',
      'apicircle.addMockRequestSchemaBodyExample',
      'apicircle.setMockParamTypeField',
    ]) {
      expect(ids.has(id), `${id} missing from contributes.commands`).toBe(true);
      expect(events.has(`onCommand:${id}`), `${id} missing onCommand activation`).toBe(true);
    }
  });

  it('removed authoring affordances are fully unregistered (no command + no activation)', () => {
    // The boolean `required:` row (edited directly in YAML) and the per-field
    // auth editor were removed from the CodeLens surfaces; their commands must
    // not linger as dangling palette entries.
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    const events = new Set(pkg.activationEvents);
    for (const id of ['apicircle.toggleMockParamRequired', 'apicircle.setRequestAuthField']) {
      expect(ids.has(id), `${id} should be removed from contributes.commands`).toBe(false);
      expect(events.has(`onCommand:${id}`), `${id} should be removed from activationEvents`).toBe(
        false,
      );
    }
  });

  it('Add Mock Validation Rule no longer carries the trailing ellipsis (it no longer prompts)', () => {
    const pkg = readManifest();
    const cmd = pkg.contributes.commands.find(
      (c) => c.command === 'apicircle.addMockValidationRule',
    );
    expect(cmd).toBeDefined();
    expect(cmd!.title).toBe('Add Mock Validation Rule');
  });

  it('all line-addressed mock field-editor commands are declared & activated', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    const events = new Set(pkg.activationEvents);
    for (const id of [
      'apicircle.setMockMethodField',
      'apicircle.setMockStatusField',
      'apicircle.setMockBodyTypeField',
      'apicircle.setMockHeaderKeyField',
      'apicircle.setMockHeaderValueField',
      'apicircle.setMockClauseScopeField',
      'apicircle.setMockClauseOpField',
      'apicircle.setMockClauseTargetField',
      'apicircle.setMockClauseValueField',
      'apicircle.toggleMockHeaderEnabled',
      'apicircle.addMockConditionClause',
      'apicircle.setMockMultiplierKindField',
      'apicircle.setMockMultiplierKeyField',
      'apicircle.setMockMultiplierTargetPathField',
      'apicircle.setMockTextField',
      'apicircle.setMockNumberField',
      'apicircle.formatJson',
    ]) {
      expect(ids.has(id), `${id} missing from contributes.commands`).toBe(true);
      expect(events.has(`onCommand:${id}`), `${id} missing onCommand activation`).toBe(true);
    }
  });

  it('post-launch UX: display name + container title use the spaced "API Circle Studio" brand', () => {
    const pkg = readManifest() as Manifest & {
      displayName?: string;
      contributes: {
        viewsContainers?: { activitybar?: Array<{ id: string; title?: string }> };
        configuration: { title?: string };
      };
    };
    expect(pkg.displayName).toBe('API Circle Studio');
    expect(pkg.contributes.configuration.title).toBe('API Circle Studio');
    const apicircleContainer = (pkg.contributes.viewsContainers?.activitybar ?? []).find(
      (c) => c.id === 'apicircle',
    );
    expect(apicircleContainer?.title).toBe('API Circle Studio');
  });

  it('Mock sidebar pencil opens the per-endpoint YAML, not the form webview', () => {
    // The pencil (inline group, position 1) on mock-endpoint rows must
    // route to apicircle.openMockEndpointYaml. The legacy
    // editMockEndpoint (form webview) is kept as a context-menu entry
    // but no longer occupies the inline slot — the YAML is the
    // canonical edit surface.
    const pkg = readManifest() as Manifest & {
      contributes: {
        menus?: {
          'view/item/context'?: Array<{ command?: string; when?: string; group?: string }>;
        };
      };
    };
    const entries = pkg.contributes.menus?.['view/item/context'] ?? [];
    const inlinePencil = entries.find(
      (e) =>
        (e.when ?? '').includes('viewItem == mock-endpoint') &&
        (e.group ?? '').startsWith('inline'),
    );
    expect(inlinePencil, 'inline mock-endpoint menu entry missing').toBeDefined();
    expect(inlinePencil!.command).toBe('apicircle.openMockEndpointYaml');
  });

  it('post-launch UX: snapshot rows expose Restore + Delete inline', () => {
    // Pre-fix the actions were context-menu-only — users couldn't see
    // them on hover. The inline-group entries surface the icons in the
    // row gutter alongside the snapshot label.
    const pkg = readManifest() as Manifest & {
      contributes: {
        menus?: {
          'view/item/context'?: Array<{ command?: string; when?: string; group?: string }>;
        };
      };
    };
    const entries = pkg.contributes.menus?.['view/item/context'] ?? [];
    const restoreInline = entries.find(
      (e) =>
        e.command === 'apicircle.restoreSnapshot' &&
        (e.when ?? '').includes('snapshot-entry') &&
        (e.group ?? '').startsWith('inline'),
    );
    const deleteInline = entries.find(
      (e) =>
        e.command === 'apicircle.deleteSnapshot' &&
        (e.when ?? '').includes('snapshot-entry') &&
        (e.group ?? '').startsWith('inline'),
    );
    expect(restoreInline, 'restoreSnapshot missing inline menu entry').toBeDefined();
    expect(deleteInline, 'deleteSnapshot missing inline menu entry').toBeDefined();
  });

  it('every vscode.lm MCP provider id passed at runtime is declared in contributes.mcpServerDefinitionProviders', () => {
    // Second first-install repro: Phase 10 wired
    // `vscode.lm.registerMcpServerDefinitionProvider('apicircle-embedded', ...)`
    // but never declared "apicircle-embedded" in
    // contributes.mcpServerDefinitionProviders. VS Code 1.94+
    // throws on registration when the id isn't in the manifest, and
    // the throw escapes activate() — the whole extension fails to
    // load. Pin every id that source code passes to
    // registerMcpServerDefinitionProvider against the manifest.
    const pkg = readManifest() as Manifest & {
      contributes: { mcpServerDefinitionProviders?: Array<{ id: string; label?: string }> };
    };
    const declaredIds = new Set(
      (pkg.contributes.mcpServerDefinitionProviders ?? []).map((p) => p.id),
    );

    // Scan src/ for every registerMcpServerDefinitionProvider call and
    // pull the first-arg string literal.
    const srcDir = path.resolve(__dirname);
    const runtimeIds = new Set<string>();
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          const text = fs.readFileSync(full, 'utf8');
          const re = /registerMcpServerDefinitionProvider\s*\(\s*['"]([^'"]+)['"]/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
            runtimeIds.add(m[1]);
          }
        }
      }
    }
    walk(srcDir);

    const missing = [...runtimeIds].filter((id) => !declaredIds.has(id));
    expect(
      missing,
      `vscode.lm.registerMcpServerDefinitionProvider id(s) NOT declared in package.json contributes.mcpServerDefinitionProviders: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every runtime dependency declared in package.json is bundled (noExternal in tsup.config.ts)', () => {
    // First-install bug repro: `proper-lockfile` was listed in
    // `apps/vscode/package.json` dependencies but missing from the
    // `noExternal` list, so tsup left it external. The .vsix is built
    // with `vsce package --no-dependencies`, which ships no
    // `node_modules` — so the import threw `Cannot find package
    // 'proper-lockfile'` at activation, every command registered as
    // "not found", and discovery never ran. Every runtime dep (other
    // than `vscode`, which the host injects) must be bundled.
    const pkg = readManifest() as Manifest & {
      dependencies?: Record<string, string>;
    };
    const tsupConfigPath = path.resolve(__dirname, '..', 'tsup.config.ts');
    const tsupConfigText = fs.readFileSync(tsupConfigPath, 'utf8');
    // Extract every quoted string between `noExternal: [` and the matching `]`.
    const noExternalMatch = tsupConfigText.match(/noExternal\s*:\s*\[([\s\S]*?)\]/);
    expect(noExternalMatch, 'noExternal array not found in tsup.config.ts').not.toBeNull();
    const noExternal = new Set(
      (noExternalMatch![1].match(/['"]([^'"]+)['"]/g) ?? []).map((q) => q.slice(1, -1)),
    );
    const runtimeDeps = Object.keys(pkg.dependencies ?? {});
    const missing = runtimeDeps.filter((d) => d !== 'vscode' && !noExternal.has(d));
    expect(
      missing,
      `package.json runtime deps NOT in tsup noExternal (must be bundled because vsce --no-dependencies ships no node_modules): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('release-ledger commands are declared & activated', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    const events = new Set(pkg.activationEvents);
    for (const id of [
      'apicircle.openReleaseHistory',
      'apicircle.publishRelease',
      'apicircle.deprecateRelease',
      'apicircle.withdrawRelease',
    ]) {
      expect(ids.has(id), `${id} missing from contributes.commands`).toBe(true);
      expect(events.has(`onCommand:${id}`), `${id} missing onCommand activation`).toBe(true);
    }
  });

  it('linked-workspace commands are declared & activated', () => {
    const pkg = readManifest();
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    const events = new Set(pkg.activationEvents);
    for (const id of [
      'apicircle.linkWorkspace',
      'apicircle.searchMarketplace',
      'apicircle.refreshLinkedWorkspace',
      'apicircle.reviewLinkedUpdate',
      'apicircle.tagRelease',
      'apicircle.editRepoTopics',
      'apicircle.unlinkWorkspace',
      'apicircle.openLinkYaml',
      'apicircle.showLinkedChangelog',
      'apicircle.setLinkNameField',
      'apicircle.setLinkDescriptionField',
      'apicircle.setLinkPinnedVersionField',
      'apicircle.setLinkScopeField',
      'apicircle.setLinkSessionModeField',
      'apicircle.addLinkRequiredKey',
      'apicircle.removeLinkRequiredKey',
      'apicircle.setLinkSessionToken',
      'apicircle.clearLinkSessionToken',
      'apicircle.openLinkedRequest',
      'apicircle.resetLinkedRequest',
      'apicircle.discardLinkedMods',
      'apicircle.provisionLinkedSecret',
      'apicircle.clearLinkedSecret',
      'apicircle.setLinkedEnvVarOverride',
    ]) {
      expect(ids.has(id), `${id} missing from contributes.commands`).toBe(true);
      expect(events.has(`onCommand:${id}`), `${id} missing onCommand activation`).toBe(true);
    }
  });

  it('linked-workspace context menu wires refresh + unlink', () => {
    const pkg = readManifest() as Manifest & {
      contributes: { menus?: { 'view/item/context'?: Array<{ command?: string; when?: string }> } };
    };
    const entries = pkg.contributes.menus?.['view/item/context'] ?? [];
    const refresh = entries.find(
      (e) =>
        e.command === 'apicircle.refreshLinkedWorkspace' &&
        (e.when ?? '').includes('apicircleLinkedWorkspace'),
    );
    const unlink = entries.find(
      (e) =>
        e.command === 'apicircle.unlinkWorkspace' &&
        (e.when ?? '').includes('apicircleLinkedWorkspace'),
    );
    expect(refresh, 'refresh context menu missing').toBeDefined();
    expect(unlink, 'unlink context menu missing').toBeDefined();
  });

  it('the Link Workspaces view replaced the Marketplace stub', () => {
    const pkg = readManifest() as Manifest & {
      contributes: {
        views?: { apicircle?: Array<{ id: string; name: string; when?: string }> };
      };
    };
    const views = pkg.contributes.views?.apicircle ?? [];
    const ids = views.map((v) => v.id);
    expect(ids).toContain('apicircle.linkWorkspaces');
    expect(ids).not.toContain('apicircle.marketplace');
    // The view is always-on now — no enableMarketplace gate.
    const link = views.find((v) => v.id === 'apicircle.linkWorkspaces');
    expect(link?.when).toBeUndefined();
    expect(pkg.contributes.configuration.properties['apicircle.enableMarketplace']).toBeUndefined();
  });

  it('per-version release context menu wires Deprecate + Withdraw', () => {
    const pkg = readManifest() as Manifest & {
      contributes: {
        menus?: { 'view/item/context'?: Array<{ command?: string; when?: string }> };
      };
    };
    const entries = pkg.contributes.menus?.['view/item/context'] ?? [];
    const deprecate = entries.find(
      (e) =>
        e.command === 'apicircle.deprecateRelease' &&
        (e.when ?? '').includes('apicircleReleaseVersion'),
    );
    const withdraw = entries.find(
      (e) =>
        e.command === 'apicircle.withdrawRelease' &&
        (e.when ?? '').includes('apicircleReleaseVersion'),
    );
    expect(deprecate, 'deprecateRelease context menu missing').toBeDefined();
    expect(withdraw, 'withdrawRelease context menu missing').toBeDefined();
  });

  it('apicircle.editor viewsWelcome splits on apicircle.hasActiveWorkspace', () => {
    const pkg = readManifest() as Manifest & {
      contributes: { viewsWelcome?: ViewWelcomeEntry[] };
    };
    const editorEntries = (pkg.contributes.viewsWelcome ?? []).filter(
      (e) => e.view === 'apicircle.editor',
    );
    // Two distinct entries — one for the no-workspace case, one for when
    // the bridge has already adopted a `.apicircle/workspace.json`.
    expect(editorEntries.length).toBe(2);

    const noWorkspace = editorEntries.find((e) => e.when === '!apicircle.hasActiveWorkspace');
    const withWorkspace = editorEntries.find((e) => e.when === 'apicircle.hasActiveWorkspace');
    expect(noWorkspace).toBeDefined();
    expect(withWorkspace).toBeDefined();

    // No-workspace copy still surfaces the create + open-folder actions.
    expect(noWorkspace!.contents ?? '').toContain('command:apicircle.createWorkspace');
    expect(noWorkspace!.contents ?? '').toContain('command:workbench.action.files.openFolder');

    // Workspace-present copy must NOT shout "Create New Workspace" — that
    // copy is the exact thing that made users think the .apicircle folder
    // wasn't detected.
    expect(withWorkspace!.contents ?? '').not.toContain('command:apicircle.createWorkspace');
    expect(withWorkspace!.contents ?? '').toContain('command:apicircle.newRequest');
  });
});
