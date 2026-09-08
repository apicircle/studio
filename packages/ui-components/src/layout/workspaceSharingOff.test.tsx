import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LinkedSnapshot, LinkedWorkspace, Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../store/workspaceStore';
import { isWorkspaceSharingEnabled } from './workspaceSharing';
import { LinkWorkspacePanel } from '../panels/link-workspace/LinkWorkspacePanel';
import { UpdatePreviewModal } from '../panels/link-workspace/UpdatePreviewModal';
import { LinkedReleaseNotes } from '../panels/link-workspace/LinkedReleaseNotes';
import { LinkedWorkspaceTreeSection } from '../panels/editor/LinkedWorkspaceTreeSection';
import { LinkedEnvironmentsSection } from '../panels/env/LinkedEnvironmentsSection';
import { ReleaseAndTopicsModal } from '../panels/workspace/ReleaseAndTopicsModal';
import { EnvironmentsSidebar } from '../panels/env/EnvironmentsSidebar';

// The SHIPPED configuration. Every other suite that touches the sharing
// cluster spies `isWorkspaceSharingEnabled` to `true` so the feature's own
// behaviour stays covered; this one deliberately does not, so exactly one file
// asserts what a real user gets.
//
// Deliberately seeds links and a linked snapshot first. Asserting "nothing
// renders" against an empty workspace would pass for the wrong reason — these
// components already return null when there is nothing to show, and a
// workspace authored by a sharing-enabled build (API Circle Lens, or a later
// Studio) is exactly the case where the data is present and the surfaces still
// must not appear.

const T0 = '2026-04-27T00:00:00.000Z';

function makeRequest(id: string, name: string): ApiRequest {
  return {
    id,
    name,
    folderId: null,
    method: 'GET',
    url: `https://example.test/${id}`,
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: T0,
    updatedAt: T0,
  };
}

function makeLink(): LinkedWorkspace {
  return {
    id: 'lw-1',
    kind: 'public',
    name: 'Payments',
    sourceWorkspaceId: 'src-ws-1',
    source: {
      provider: 'github',
      repoFullName: 'org/payments',
      branch: 'main',
      sessionMode: 'workspace',
    },
    scope: ['collections', 'environments'],
    pinnedVersion: '1.0.0',
    updatePolicy: 'manual',
    linkedAt: T0,
    requiredSecretKeyIds: ['db-token'],
  };
}

function makeSnapshot(): LinkedSnapshot {
  const req = makeRequest('req-1', 'List payments');
  return {
    pulledAt: T0,
    ref: 'v1.0.0',
    collections: {
      tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: req.id }] },
      requests: { [req.id]: req },
      folders: {},
    },
    environments: {
      items: {
        Prod: {
          name: 'Prod',
          variables: [{ key: 'HOST', value: 'https://pay.test', encrypted: false }],
        },
      },
      activeName: 'Prod',
      priorityOrder: [],
    },
  };
}

async function seedLinkedWorkspace(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
  const { synced, local } = useWorkspaceStore.getState();
  useWorkspaceStore.setState({
    synced: {
      ...synced!,
      linkedWorkspaces: { 'lw-1': makeLink() },
      releases: {
        ...synced!.releases,
        perLink: {
          'lw-1': {
            currentVersion: '1.1.0',
            versions: [
              {
                version: '1.1.0',
                publishedAt: T0,
                notes: 'Adds refunds',
                workspaceSnapshot: 'sha',
                deprecated: false,
                yanked: false,
              },
            ],
          },
        },
      },
    },
    local: { ...local!, linkedCollections: { 'lw-1': makeSnapshot() } },
  });
}

describe('workspace sharing is off in shipped builds', () => {
  beforeEach(seedLinkedWorkspace);

  it('is off — the assertion this whole change rests on', () => {
    expect(isWorkspaceSharingEnabled()).toBe(false);
  });

  it('renders no Link Workspace panel, even with links present', () => {
    const { container } = render(<LinkWorkspacePanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders no linked-update modal', () => {
    const { container } = render(<UpdatePreviewModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders no linked release notes, even with a populated per-link ledger', () => {
    const { container } = render(
      <LinkedReleaseNotes linkedWorkspaceId="lw-1" fromVersion={null} toVersion="1.1.0" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders no linked collections section in the editor sidebar', () => {
    const { container } = render(<LinkedWorkspaceTreeSection />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Payments')).not.toBeInTheDocument();
  });

  it('renders no linked environments section', () => {
    const { container } = render(<LinkedEnvironmentsSection />);
    expect(container.firstChild).toBeNull();
  });

  it('renders no Release & topics modal, even when asked to open', () => {
    const { container } = render(<ReleaseAndTopicsModal open onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('offers no linked environments in the environments sidebar', async () => {
    await act(async () => {
      render(<EnvironmentsSidebar />);
    });
    // The source env is named "Prod" and belongs to the link "Payments";
    // neither may reach the priority list.
    expect(screen.queryByText('Payments')).not.toBeInTheDocument();
    expect(screen.queryByText('Prod')).not.toBeInTheDocument();
  });
});
