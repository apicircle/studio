// Result types for `refreshFromDisk` — the workspace disk-mirror refresh.
//
// These lived in `panels/mcp/mcpPanelTypes.ts` and were named `McpRefreshResult`
// because the MCP panel happened to expose the only Refresh button. The feature
// is workspace persistence, not MCP: `App.tsx` calls `refreshFromDisk` on
// startup so an external write (another surface, a git pull) shows up without a
// restart. The MCP panel is gone; the refresh is not.

/**
 * On-disk content counts surfaced in refresh-result toasts so users can
 * spot a missing collection at a glance (e.g. "the mirror claims 21 requests
 * but disk only shows 1 — something overwrote it").
 */
export interface RefreshDiskCounts {
  requests: number;
  folders: number;
  environments: number;
}

/**
 * Result of `refreshFromDisk`. Callers show a toast variant matching the kind
 * so the user knows whether anything actually changed.
 */
export type RefreshFromDiskResult =
  | { kind: 'no-mirror' } // web build — disk mirror unavailable
  | { kind: 'no-file' } // mirror enabled but no on-disk file yet
  | { kind: 'up-to-date'; counts: RefreshDiskCounts } // disk == memory; nothing to do
  | { kind: 'updated'; importedAt: string; counts: RefreshDiskCounts } // disk was newer; store was hydrated
  | {
      kind: 'merged';
      importedRequestIds: string[];
      importedFolderIds: string[];
      counts: RefreshDiskCounts;
    } // workspaceId mismatch resolved via one-time merge
  | { kind: 'error'; message: string };
