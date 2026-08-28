import { describe, it, expect } from 'vitest';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { MockView } from './MockView';

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
