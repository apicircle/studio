import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePanel } from './WorkspacePanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import * as workspaceSharing from '../../layout/workspaceSharing';

// Golden DOM for the working-branch card and its two modals, as plain Studio
// renders them — with no edition plugging changes of its own into the branch.
// Editions may add sections to this card (`<App branchChangeSources>`); with none
// registered every byte here must stay as it was. A deliberate change to the card
// updates these snapshots in the same commit and says why.

beforeEach(() => {
  vi.spyOn(workspaceSharing, 'isWorkspaceSharingEnabled').mockReturnValue(true);
});

function seedBranch(lastPushedSha: string | null): void {
  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    local: {
      ...local,
      sync: { ...local.sync, lastPulledAt: null },
      sessions: {
        github: {
          workspace: {
            accountLogin: 'me',
            tokenSecretId: 'sec',
            grantedScopes: ['repo'],
            addedAt: 't',
            lastVerifiedAt: 't',
            canCreatePullRequests: true,
          },
          links: {},
        },
      },
      connectedRepo: {
        fullName: 'me/api',
        owner: 'me',
        name: 'api',
        defaultBranch: 'main',
        visibility: 'public',
        isPrivate: false,
        pushable: true,
        connectedAt: 't',
      },
      workingBranch: {
        name: 'apicircle/golden',
        baseBranch: 'main',
        repoFullName: 'me/api',
        repoOwner: 'me',
        repoName: 'api',
        headSha: 'abc1234def',
        createdAt: 't',
        lastPushedSha,
        diffSummary: null,
        openPrUrl: null,
      },
    },
  });
}

const card = (): HTMLElement =>
  screen
    .getByText('apicircle/golden')
    .closest('.rounded-sm.border.border-border.bg-card.p-3') as HTMLElement;

describe('working-branch card — golden DOM with no branch change sources', () => {
  it('renders the card exactly as before, clean and never pushed', async () => {
    await renderWithStore(<WorkspacePanel />);
    await act(async () => seedBranch(null));
    expect(card().outerHTML).toMatchSnapshot();
  });

  it('renders the unpushed-changes strip and preview exactly as before', async () => {
    await renderWithStore(<WorkspacePanel />);
    await act(async () => {
      seedBranch(null);
      useWorkspaceStore.getState().addEnvironment('Staging');
    });
    expect(card().outerHTML).toMatchSnapshot('card with one unpushed change');
    await userEvent.click(screen.getByRole('button', { name: 'Show unpushed changes preview' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unpushed changes preview' });
    // The environment's generated id is not stable from run to run.
    expect(
      dialog.outerHTML.replace(
        /[0-9a-f]{8}-[0-9a-f-]{27}|title="Entry id: [^"]+"|>[0-9A-Za-z_-]{8}</g,
        '<ID>',
      ),
    ).toMatchSnapshot('unpushed changes preview');
  });

  it('renders the pull-request modal exactly as before', async () => {
    await renderWithStore(<WorkspacePanel />);
    await act(async () => seedBranch('abc1234def'));
    await userEvent.click(screen.getByRole('button', { name: 'Create PR' }));
    const dialog = await screen.findByRole('dialog', { name: 'Open pull request' });
    expect(dialog.outerHTML).toMatchSnapshot();
  });
});
