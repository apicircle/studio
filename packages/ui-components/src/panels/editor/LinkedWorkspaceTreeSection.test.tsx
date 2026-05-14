import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LinkedSnapshot, LinkedWorkspace, Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { LinkedWorkspaceTreeSection } from './LinkedWorkspaceTreeSection';

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

function makeSnapshot(requests: ApiRequest[]): LinkedSnapshot {
  return {
    pulledAt: T0,
    ref: 'v1.0.0',
    collections: {
      tree: {
        id: 'r',
        type: 'root',
        children: requests.map((r) => ({ kind: 'request' as const, id: r.id })),
      },
      requests: Object.fromEntries(requests.map((r) => [r.id, r])),
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
  };
}

function makeLink(id: string, overrides: Partial<LinkedWorkspace> = {}): LinkedWorkspace {
  return {
    id,
    kind: 'public',
    name: `Link ${id}`,
    source: {
      provider: 'github',
      repoFullName: `org/${id}`,
      branch: 'main',
      sessionMode: 'workspace' as const,
    },
    scope: ['collections'],
    pinnedVersion: '1.0.0',
    updatePolicy: 'manual',
    linkedAt: T0,
    requiredSecretKeyIds: [],
    ...overrides,
  };
}

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

describe('LinkedWorkspaceTreeSection', () => {
  beforeEach(hydrate);

  it('renders nothing when there are no linked workspaces', () => {
    const { container } = render(<LinkedWorkspaceTreeSection />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one collapsible root per linked workspace with the pinned-version chip', () => {
    const synced = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: {
          'lw-1': makeLink('lw-1', { name: 'Payments' }),
          'lw-2': makeLink('lw-2', { name: 'Weather', pinnedVersion: '2.3.1' }),
        },
      },
    });
    render(<LinkedWorkspaceTreeSection />);
    expect(screen.getByText('Payments')).toBeInTheDocument();
    expect(screen.getByText('Weather')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('v2.3.1')).toBeInTheDocument();
  });

  it('expanding a link with a missing snapshot shows a refresh hint', async () => {
    const synced = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: { 'lw-1': makeLink('lw-1', { name: 'Payments' }) },
      },
    });
    render(<LinkedWorkspaceTreeSection />);
    await userEvent.click(screen.getByRole('button', { name: /Expand linked workspace Payments/ }));
    // Inline empty-state copy + the "Refresh link" CTA — replaces the
    // earlier text-only hint that pointed users at the Link Workspace
    // panel.
    expect(screen.getByText(/Snapshot not loaded yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh link/ })).toBeInTheDocument();
  });

  it('expanding a link with a snapshot lists its requests; clicking opens the linked-request editor', async () => {
    const synced = useWorkspaceStore.getState().synced!;
    const local = useWorkspaceStore.getState().local!;
    const req = makeRequest('src-r1', 'Get user');
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: { 'lw-1': makeLink('lw-1', { name: 'Payments' }) },
      },
      local: { ...local, linkedCollections: { 'lw-1': makeSnapshot([req]) } },
    });
    render(<LinkedWorkspaceTreeSection />);
    await userEvent.click(screen.getByRole('button', { name: /Expand linked workspace Payments/ }));
    const openBtn = screen.getByRole('button', { name: /Open Get user from Payments/ });
    expect(openBtn).toBeInTheDocument();
    await userEvent.click(openBtn);
    expect(useWorkspaceStore.getState().activeLinkedRequest).toEqual({
      linkedWorkspaceId: 'lw-1',
      itemId: 'src-r1',
    });
  });

  it('renders the source-side folder auth shield when a linked folder has its own auth', async () => {
    const synced = useWorkspaceStore.getState().synced!;
    const local = useWorkspaceStore.getState().local!;
    const folder = {
      id: 'src-f1',
      name: 'Authenticated APIs',
      parentId: null,
      auth: { type: 'bearer' as const, token: '{{TOKEN}}' },
    };
    const req = makeRequest('src-r1', 'Inside auth folder');
    req.folderId = folder.id;
    const snapshot: LinkedSnapshot = {
      pulledAt: T0,
      ref: 'v1.0.0',
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'folder', id: folder.id }] },
        requests: { [req.id]: req },
        folders: { [folder.id]: folder },
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
    };
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: { 'lw-1': makeLink('lw-1', { name: 'Payments' }) },
      },
      local: { ...local, linkedCollections: { 'lw-1': snapshot } },
    });
    render(<LinkedWorkspaceTreeSection />);
    await userEvent.click(screen.getByRole('button', { name: /Expand linked workspace Payments/ }));
    // Shield carries an aria-label that names the folder's auth type so
    // screen-reader users see the cascade context, matching how the
    // local tree's shield works.
    expect(screen.getByLabelText(/Source-side folder auth: bearer/)).toBeInTheDocument();
  });

  it('shows a "modified" dot on linked requests with an override', async () => {
    const synced = useWorkspaceStore.getState().synced!;
    const local = useWorkspaceStore.getState().local!;
    const req = makeRequest('src-r1', 'Get user');
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: { 'lw-1': makeLink('lw-1', { name: 'Payments' }) },
      },
      local: { ...local, linkedCollections: { 'lw-1': makeSnapshot([req]) } },
    });
    useWorkspaceStore.getState().setLinkedRequestOverride('lw-1', 'src-r1', {
      url: 'https://staging.example.test/src-r1',
    });

    render(<LinkedWorkspaceTreeSection />);
    await userEvent.click(screen.getByRole('button', { name: /Expand linked workspace Payments/ }));
    expect(
      screen.getByRole('button', { name: /Open Get user from Payments \(modified\)/ }),
    ).toBeInTheDocument();
    // The "X mod" badge on the root row
    expect(screen.getByText(/1 mod/)).toBeInTheDocument();
  });
});
