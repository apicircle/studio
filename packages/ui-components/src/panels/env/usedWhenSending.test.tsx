import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LinkedSnapshot, LinkedWorkspace } from '@apicircle/shared';
import { EnvironmentsPanel } from './EnvironmentsPanel';
import { EnvironmentsSidebar } from './EnvironmentsSidebar';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import * as download from '../../primitives/download';
import * as workspaceSharing from '../../layout/workspaceSharing';

// Environments say "used when sending" (STU-UX-11), and an export downloads
// through the one download helper.

describe('The environment editor', () => {
  it('says when an environment is not used when sending, and how to change that', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().setPriorityOrder([]);
    });
    const badge = screen.getByText('Not used when sending');
    expect(badge).toHaveAttribute('title', 'Tick it in the list to use it when sending.');
    expect(screen.queryByText(/global (priority )?layer|resolver/i)).toBeNull();
  });
});

describe('The environment list', () => {
  it('exports an environment as JSON named after it', async () => {
    const save = vi.spyOn(download, 'downloadTextFile').mockReturnValue(true);
    await renderWithStore(<EnvironmentsSidebar />);
    act(() => useWorkspaceStore.getState().addEnvironment('Staging EU'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Environment actions for Staging EU' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Export as JSON' }));
    const [name, json, type] = save.mock.calls[0];
    expect(name).toBe('Staging_EU.apicircle-env.json');
    expect(json).toBe(useWorkspaceStore.getState().exportEnvironment('Staging EU'));
    expect(json).toContain('"Staging EU"');
    expect(type).toBe('application/json');
  });

  it('names a linked environment’s checkbox with the workspace it comes from', async () => {
    vi.spyOn(workspaceSharing, 'isWorkspaceSharingEnabled').mockReturnValue(true);
    const link = {
      id: 'lw-1',
      kind: 'public',
      name: 'Payments',
      sourceWorkspaceId: 'src',
      source: {
        provider: 'github',
        repoFullName: 'org/payments',
        branch: 'main',
        sessionMode: 'workspace',
      },
      scope: ['environments'],
      pinnedVersion: '1.0.0',
      updatePolicy: 'manual',
      linkedAt: 't',
      requiredSecretKeyIds: [],
    } satisfies LinkedWorkspace;
    const snapshot: LinkedSnapshot = {
      pulledAt: 't',
      ref: 'v1.0.0',
      collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: {
        items: { dev: { name: 'dev', variables: [] } },
        activeName: 'dev',
        priorityOrder: [],
      },
    };
    await renderWithStore(<EnvironmentsSidebar />);
    act(() => {
      const { synced, local } = useWorkspaceStore.getState();
      useWorkspaceStore.setState({
        synced: { ...synced!, linkedWorkspaces: { [link.id]: link } },
        local: { ...local!, linkedCollections: { [link.id]: snapshot } },
      });
    });
    const list = screen.getByRole('list', { name: 'Environments' });
    expect(
      within(list).getByRole('checkbox', { name: 'Use dev (linked from Payments) when sending' }),
    ).not.toBeChecked();
  });
});
