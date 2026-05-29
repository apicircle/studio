import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../store/workspaceStore';
import { AttachmentDownloadPromptModal } from './AttachmentDownloadPromptModal';

const originalSyncAttachments = useWorkspaceStore.getState().syncAttachments;

describe('AttachmentDownloadPromptModal', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      attachmentDownloadPrompt: null,
      toasts: [],
      syncAttachments: originalSyncAttachments,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useWorkspaceStore.setState({
      attachmentDownloadPrompt: null,
      toasts: [],
      syncAttachments: originalSyncAttachments,
    });
  });

  it('shows required file details and cancels execution', async () => {
    let accepted: boolean | null = null;
    seedPrompt((next) => {
      accepted = next;
    });

    render(<AttachmentDownloadPromptModal />);

    expect(screen.getByRole('dialog', { name: 'Download required attachment?' })).toBeVisible();
    expect(screen.getByText('payload.csv')).toBeVisible();
    expect(screen.getAllByText('32 B')).toHaveLength(2);
    expect(screen.getByText('text/csv')).toBeVisible();
    expect(screen.getByText(/Required by Upload customers/)).toBeVisible();
    expect(screen.getByText('not downloaded locally')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /Cancel execution/ }));

    expect(accepted).toBe(false);
    expect(useWorkspaceStore.getState().attachmentDownloadPrompt).toBeNull();
  });

  it('downloads attachments and resolves execution after successful sync', async () => {
    const syncAttachments = vi.fn(async () => ({ fetched: 1, alreadyPresent: 0, failed: 0 }));
    let accepted: boolean | null = null;
    useWorkspaceStore.setState({ syncAttachments });
    seedPrompt((next) => {
      accepted = next;
    });

    render(<AttachmentDownloadPromptModal />);

    await userEvent.click(screen.getByRole('button', { name: /Download and continue/ }));

    await waitFor(() => expect(syncAttachments).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(accepted).toBe(true));
    expect(useWorkspaceStore.getState().attachmentDownloadPrompt).toBeNull();
  });

  it('keeps the prompt open when download fails', async () => {
    const syncAttachments = vi.fn(async () => ({ fetched: 0, alreadyPresent: 0, failed: 1 }));
    let accepted: boolean | null = null;
    useWorkspaceStore.setState({ syncAttachments });
    seedPrompt((next) => {
      accepted = next;
    });

    render(<AttachmentDownloadPromptModal />);

    await userEvent.click(screen.getByRole('button', { name: /Download and continue/ }));

    await waitFor(() => expect(screen.getByText(/could not be downloaded/)).toBeVisible());
    expect(accepted).toBeNull();
    expect(useWorkspaceStore.getState().attachmentDownloadPrompt).not.toBeNull();
  });
});

function seedPrompt(resolve: (accepted: boolean) => void): void {
  act(() => {
    useWorkspaceStore.setState({
      attachmentDownloadPrompt: {
        id: 'prompt-1',
        title: 'Download required attachment?',
        detail:
          'This request needs file assets that are not available on this machine. Download them now to continue, or cancel execution.',
        items: [
          {
            slotId: 'slot-1',
            filename: 'payload.csv',
            mimeType: 'text/csv',
            size: 32,
            source: 'linked-workspace',
            linkedWorkspaceId: 'link-1',
            requiredBy: [{ requestId: 'req-1', requestName: 'Upload customers' }],
          },
        ],
        resolve,
      },
    });
  });
}
