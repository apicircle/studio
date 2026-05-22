import { ipcMain } from 'electron';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { assertTrustedSender } from '../security/assertTrustedSender';
import type { WorkspaceFileManager } from '../workspaceFile/workspaceFileManager';
import type { WorkspaceRegistry, WorkspaceRegistryEntry } from '@apicircle/core/workspace/registry';

// =============================================================================
// IPC bridge for the multi-workspace on-disk mirror.
//
// Channels (every one is sender-checked + payload-validated):
//
//   apicircle:workspaceFile:status              → { workspacesRoot }
//   apicircle:workspaceFile:init                → { registry, migrated }
//   apicircle:workspaceFile:readRegistry        → WorkspaceRegistry
//   apicircle:workspaceFile:writeRegistry(r)    → void
//   apicircle:workspaceFile:readWorkspace(id)   → { synced, local } | null
//   apicircle:workspaceFile:writeWorkspace(...) → void
//   apicircle:workspaceFile:deleteWorkspace(id) → WorkspaceRegistry
//   apicircle:workspaceFile:registerWorkspace(e) → WorkspaceRegistry
//   apicircle:workspaceFile:setActiveWorkspace(id) → WorkspaceRegistry
//   apicircle:workspaceFile:flush               → void
//
// The renderer's `diskMirror` adapter consumes this surface; web builds get
// `apicircleDesktop = undefined` and the adapter no-ops every method.
// =============================================================================

const CHANNEL = {
  status: 'apicircle:workspaceFile:status',
  init: 'apicircle:workspaceFile:init',
  readRegistry: 'apicircle:workspaceFile:readRegistry',
  writeRegistry: 'apicircle:workspaceFile:writeRegistry',
  readWorkspace: 'apicircle:workspaceFile:readWorkspace',
  writeWorkspace: 'apicircle:workspaceFile:writeWorkspace',
  deleteWorkspace: 'apicircle:workspaceFile:deleteWorkspace',
  registerWorkspace: 'apicircle:workspaceFile:registerWorkspace',
  setActiveWorkspace: 'apicircle:workspaceFile:setActiveWorkspace',
  flush: 'apicircle:workspaceFile:flush',
} as const;

// Hard cap on the JSON payload size the renderer can ship to disk in one
// write. The workspace doc is a few hundred KB at most under normal use;
// give ourselves 25 MB of headroom for very-large mock catalogs / global
// assets but reject anything beyond so a compromised renderer can't OOM
// the main process with a 1 GB string.
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;

function assertSyncedShape(value: unknown): WorkspaceSynced {
  if (!value || typeof value !== 'object') throw new Error('synced must be an object');
  const v = value as Record<string, unknown>;
  if (typeof v.workspaceId !== 'string' || v.workspaceId.length === 0) {
    throw new Error('synced.workspaceId must be a non-empty string');
  }
  if (typeof v.schemaVersion !== 'number') throw new Error('synced.schemaVersion must be a number');
  if (!v.collections || typeof v.collections !== 'object') {
    throw new Error('synced.collections must be an object');
  }
  return value as WorkspaceSynced;
}

function assertLocalShape(value: unknown): WorkspaceLocal {
  if (!value || typeof value !== 'object') throw new Error('local must be an object');
  const v = value as Record<string, unknown>;
  if (typeof v.workspaceId !== 'string' || v.workspaceId.length === 0) {
    throw new Error('local.workspaceId must be a non-empty string');
  }
  if (typeof v.schemaVersion !== 'number') throw new Error('local.schemaVersion must be a number');
  return value as WorkspaceLocal;
}

function assertWorkspaceId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error('workspaceId must be a non-empty string under 256 chars');
  }
  // Match the shape of `generateId()` outputs (hex string) plus the
  // legacy `imported-folder-*` prefix used by the disk-merge wrapper.
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('workspaceId contains unsupported characters');
  }
  return value;
}

function assertRegistryEntryShape(value: unknown): WorkspaceRegistryEntry {
  if (!value || typeof value !== 'object') throw new Error('entry must be an object');
  const v = value as Record<string, unknown>;
  const id = assertWorkspaceId(v.id);
  if (typeof v.name !== 'string' || v.name.length === 0 || v.name.length > 256) {
    throw new Error('entry.name must be a non-empty string under 256 chars');
  }
  if (typeof v.createdAt !== 'string' || typeof v.lastOpenedAt !== 'string') {
    throw new Error('entry.createdAt and entry.lastOpenedAt must be ISO strings');
  }
  return { id, name: v.name, createdAt: v.createdAt, lastOpenedAt: v.lastOpenedAt };
}

function assertRegistryShape(value: unknown): WorkspaceRegistry {
  if (!value || typeof value !== 'object') throw new Error('registry must be an object');
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1) throw new Error('registry.schemaVersion must be 1');
  if (v.activeWorkspaceId !== null && typeof v.activeWorkspaceId !== 'string') {
    throw new Error('registry.activeWorkspaceId must be a string or null');
  }
  if (!Array.isArray(v.workspaces)) throw new Error('registry.workspaces must be an array');
  return {
    schemaVersion: 1,
    activeWorkspaceId: v.activeWorkspaceId ?? null,
    workspaces: v.workspaces.map(assertRegistryEntryShape),
  };
}

function assertPayloadSize(payload: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `workspace-file payload (${bytes} bytes) exceeds MAX_PAYLOAD_BYTES (${MAX_PAYLOAD_BYTES})`,
    );
  }
}

export function registerWorkspaceFileBridge(manager: WorkspaceFileManager): void {
  ipcMain.handle(CHANNEL.status, (event) => {
    assertTrustedSender(event);
    return { workspacesRoot: manager.workspacesRoot };
  });
  ipcMain.handle(CHANNEL.init, async (event) => {
    assertTrustedSender(event);
    return manager.init();
  });
  ipcMain.handle(CHANNEL.readRegistry, async (event) => {
    assertTrustedSender(event);
    return manager.readRegistry();
  });
  ipcMain.handle(CHANNEL.writeRegistry, async (event, payload: unknown) => {
    assertTrustedSender(event);
    const registry = assertRegistryShape(payload);
    await manager.writeRegistry(registry);
  });
  ipcMain.handle(CHANNEL.readWorkspace, async (event, workspaceId: unknown) => {
    assertTrustedSender(event);
    return manager.readWorkspace(assertWorkspaceId(workspaceId));
  });
  ipcMain.handle(CHANNEL.writeWorkspace, async (event, payload: unknown) => {
    assertTrustedSender(event);
    if (!payload || typeof payload !== 'object') {
      throw new Error('payload must be an object');
    }
    assertPayloadSize(payload);
    const p = payload as Record<string, unknown>;
    const workspaceId = assertWorkspaceId(p.workspaceId);
    const synced = assertSyncedShape(p.synced);
    const local = assertLocalShape(p.local);
    if (synced.workspaceId !== workspaceId || local.workspaceId !== workspaceId) {
      throw new Error(
        `workspaceId mismatch (arg=${workspaceId} synced=${synced.workspaceId} local=${local.workspaceId})`,
      );
    }
    await manager.writeWorkspace(workspaceId, { synced, local });
  });
  ipcMain.handle(CHANNEL.deleteWorkspace, async (event, workspaceId: unknown) => {
    assertTrustedSender(event);
    return manager.deleteWorkspaceFile(assertWorkspaceId(workspaceId));
  });
  ipcMain.handle(CHANNEL.registerWorkspace, async (event, entry: unknown) => {
    assertTrustedSender(event);
    return manager.registerWorkspaceEntry(assertRegistryEntryShape(entry));
  });
  ipcMain.handle(CHANNEL.setActiveWorkspace, async (event, workspaceId: unknown) => {
    assertTrustedSender(event);
    return manager.setActiveWorkspace(assertWorkspaceId(workspaceId));
  });
  ipcMain.handle(CHANNEL.flush, async (event) => {
    assertTrustedSender(event);
    await manager.flush();
  });
}

export const WORKSPACE_FILE_CHANNELS = CHANNEL;
