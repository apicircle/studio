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
  const fakeMcp = {
    resolvePaths: () => ({ binary: 'apicircle-mcp', workspace: '', hasActiveWorkspace: false }),
    toolCatalog: () => [] as readonly never[],
    supportedClients: () => [] as readonly never[],
    getConfigSnippet: () => null,
    getConfigPath: () => null,
  } as unknown as VsCodeMcpManager;

  it('viewId matches package.json contribution', () => {
    expect(new McpView(fakeMcp).viewId).toBe('apicircle.mcp');
  });

  it('getChildren returns the three top-level rows', () => {
    const view = new McpView(fakeMcp);
    const kids = view.getChildren();
    // Phase 5: header + clients-section + connect-guide.
    expect(kids.length).toBe(3);
    expect(kids[0]).toEqual({ kind: 'header' });
  });
});
