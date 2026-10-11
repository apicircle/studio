import { getDesktopMockBridge } from '../desktop/bridge';
import { useWorkspaceStore } from '../store/workspaceStore';

// What "Also clear this workspace's Studio data" does — the option both
// confirmations of a repository disconnect offer (`ClearStudioDataOption`):
// "Disconnect repo" on the repository card, and the Disconnect of the session of
// the host the repository is on. One function, so the two dialogs cannot do two
// different things.

/**
 * Stop this workspace's running mock servers, then empty its document behind a
 * snapshot (`clearWorkspaceContent`).
 *
 * The mock servers first, because one keeps serving without its definition and
 * there will be no row left in the Mocks panel to stop it from. Best effort: a
 * mock that will not stop is no reason to keep the document, and the web build
 * has no mock runtime to ask.
 *
 * Rejects when nothing was cleared (the snapshot could not be kept); the
 * caller then leaves the repository connected and says why.
 */
export async function clearStudioData(): Promise<void> {
  const store = useWorkspaceStore.getState();
  const mocks = getDesktopMockBridge();
  if (mocks) {
    await Promise.all(
      Object.keys(store.synced?.mockServers ?? {}).map((id) =>
        mocks.stop(id).catch(() => undefined),
      ),
    );
  }
  await store.clearWorkspaceContent();
}
