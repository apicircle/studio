// Shared discriminator types for the MCP panel.

/**
 * Top-level sections in the MCP panel. Selecting one swaps the right pane.
 *
 *   - 'connection' — unified setup + live mirror status: the four-step
 *                    "wire your AI client" flow followed by the workspace
 *                    mirror path, MCP binary, and refresh control.
 *   - 'prompts'    — curated starter prompts the user can copy into
 *                    their AI client.
 */
export type McpPanelSection = 'connection' | 'prompts';

export const MCP_PANEL_SECTIONS: ReadonlyArray<{
  id: McpPanelSection;
  label: string;
  description: string;
}> = [
  {
    id: 'connection',
    label: 'Connection',
    description: 'Wire up an AI client and inspect the workspace mirror.',
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
