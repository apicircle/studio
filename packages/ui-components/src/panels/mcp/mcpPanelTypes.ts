// Shared discriminator types for the MCP panel.

/**
 * Top-level sections in the MCP panel. Selecting one swaps the right pane.
 *
 *   - 'how-to-connect' — setup instructions + per-client snippet picker
 *   - 'connection'     — live workspace mirror + binary status + refresh
 *   - 'prompts'        — curated starter prompts the user can copy into
 *                        their AI client
 */
export type McpPanelSection = 'how-to-connect' | 'connection' | 'prompts';

export const MCP_PANEL_SECTIONS: ReadonlyArray<{
  id: McpPanelSection;
  label: string;
  description: string;
}> = [
  {
    id: 'how-to-connect',
    label: 'How to Connect',
    description: 'Install the binary and wire your AI client to this workspace.',
  },
  {
    id: 'connection',
    label: 'Connection',
    description: 'Mirror status, binary path, and a refresh to pick up CLI / MCP edits.',
  },
  {
    id: 'prompts',
    label: 'Prompts',
    description: 'Starter prompts to drive this workspace from your AI client.',
  },
];

/**
 * Result of `refreshFromDisk`. The Connection section shows a toast
 * variant matching the kind so the user knows whether anything changed.
 */
export type McpRefreshResult =
  | { kind: 'no-mirror' } // web build — disk mirror unavailable
  | { kind: 'no-file' } // mirror enabled but no on-disk file yet
  | { kind: 'up-to-date' } // disk == memory; nothing to do
  | { kind: 'updated'; importedAt: string } // disk was newer; store was hydrated
  | {
      kind: 'merged';
      importedRequestIds: string[];
      importedFolderIds: string[];
    } // workspaceId mismatch resolved via one-time merge
  | { kind: 'error'; message: string };
