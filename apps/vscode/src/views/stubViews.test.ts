import { describe, it, expect } from 'vitest';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { VsCodeMcpManager } from '../host/mcpManager';
import { MockView } from './MockView';
import { McpView } from './McpView';

const emptyBridge = {
  activeWorkspace: () => undefined,
} as unknown as VsCodeBridge;

// =============================================================================
// Stub-view smoke tests — Mock (Phase 3), MCP (Phase 4).
//
// These views ship as TreeDataProvider stubs returning empty arrays; the
// concrete implementations land in their respective phases. The tests below
// pin the empty-array baseline so future fillouts can't silently regress
// (e.g. a Phase 3 commit accidentally drops the Mock view registration).
// =============================================================================

describe('MockView (Phase 3 — data wired, runtime via VsCodeMockController)', () => {
  it('viewId matches package.json contribution', () => {
    expect(new MockView(emptyBridge).viewId).toBe('apicircle.mock');
  });

  it('getChildren returns empty array when no active workspace', async () => {
    const view = new MockView(emptyBridge);
    const kids = await view.getChildren();
    expect(kids).toEqual([]);
  });
});

describe('McpView (Phase 5 — populated)', () => {
  // P5: McpView is no longer a stub. The dedicated `McpView.test.ts` suite
  // covers the populated layout in depth. Here we just hold the smoke
  // checks the original stub had so the contract (viewId + non-throwing
  // getChildren) survives whatever the populated implementation does.
  const fakeMcpNoWorkspace = {
    resolvePaths: () => ({ binary: 'apicircle-mcp', workspace: '', hasActiveWorkspace: false }),
    toolCatalog: () => [] as readonly never[],
    supportedClients: () => [] as readonly never[],
    getConfigSnippet: () => null,
    getConfigPath: () => null,
  } as unknown as VsCodeMcpManager;

  const fakeMcpWithWorkspace = {
    resolvePaths: () => ({
      binary: 'apicircle-mcp',
      workspace: '/ws/.apicircle',
      hasActiveWorkspace: true,
      isRegistryWorkspace: false,
    }),
    toolCatalog: () => [] as readonly never[],
    supportedClients: () => [] as readonly never[],
    getConfigSnippet: () => null,
    getConfigPath: () => null,
  } as unknown as VsCodeMcpManager;

  it('viewId matches package.json contribution', () => {
    expect(new McpView(fakeMcpNoWorkspace).viewId).toBe('apicircle.mcp');
  });

  it('getChildren returns empty when no workspace is active', () => {
    const view = new McpView(fakeMcpNoWorkspace);
    const kids = view.getChildren();
    expect(kids).toEqual([]);
  });

  it('getChildren returns the four top-level rows when workspace is active', () => {
    const view = new McpView(fakeMcpWithWorkspace);
    const kids = view.getChildren();
    expect(kids.length).toBe(4);
    expect(kids[0]).toEqual({ kind: 'header' });
    expect(kids[2]).toEqual({ kind: 'prompts-section' });
  });
});
