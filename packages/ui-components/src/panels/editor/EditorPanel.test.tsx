import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorPanel } from './EditorPanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

describe('EditorPanel', () => {
  it('shows the empty-state when no request is selected', async () => {
    await renderWithStore(<EditorPanel />);
    expect(screen.getByText(/Select a request from the sidebar/i)).toBeInTheDocument();
  });

  describe('with a selected request', () => {
    let id: string;

    beforeEach(async () => {
      await renderWithStore(<EditorPanel />);
      act(() => {
        id = useWorkspaceStore.getState().addRequest(null);
      });
      await waitFor(() => screen.getByLabelText('Request name'));
    });

    it('renders name, method, URL, and a Send button', () => {
      expect(screen.getByLabelText('Request name')).toHaveValue('New request');
      expect(screen.getByLabelText('HTTP method')).toHaveValue('GET');
      expect(screen.getByLabelText('Request URL')).toHaveValue('https://httpbin.org/anything');
      expect(screen.getByRole('button', { name: /Send/i })).toBeInTheDocument();
    });

    it('persists the renamed request through the store on blur', async () => {
      const input = screen.getByLabelText('Request name');
      await userEvent.clear(input);
      await userEvent.type(input, 'Get user');
      // Buffered input: store commits on blur (or Enter), not per keystroke.
      expect(useWorkspaceStore.getState().synced!.collections.requests[id].name).toBe(
        'New request',
      );
      input.blur();
      expect(useWorkspaceStore.getState().synced!.collections.requests[id].name).toBe('Get user');
    });

    it('switches HTTP method through the dropdown', async () => {
      await userEvent.selectOptions(screen.getByLabelText('HTTP method'), 'POST');
      expect(useWorkspaceStore.getState().synced!.collections.requests[id].method).toBe('POST');
    });

    it('selecting body type "json" appends a Content-Type header', async () => {
      await userEvent.click(screen.getByRole('tab', { name: /^Body/ }));
      await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
      const headers = useWorkspaceStore.getState().synced!.collections.requests[id].headers;
      expect(headers).toContainEqual({
        key: 'Content-Type',
        value: 'application/json',
        enabled: true,
      });
    });

    it('the nested Query/Path/Cookie sub-tabs carry accessible names', () => {
      // Each sub-tab's visible label sits in a capitalize <span>, so it needs an
      // explicit name — else a screen reader announces a bare "tab" (S-007).
      expect(screen.getByRole('tab', { name: /^Query/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Path' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Cookie' })).toBeInTheDocument();
    });
  });

  describe('Send + response', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('runs the request through global fetch and renders the status badge + body', async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response('{"hello":"world"}', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      await renderWithStore(<EditorPanel />);
      act(() => {
        useWorkspaceStore.getState().addRequest(null);
      });
      await waitFor(() => screen.getByLabelText('Request URL'));

      await userEvent.click(screen.getByRole('button', { name: /Send/i }));
      await waitFor(() => expect(screen.getByText('200 OK')).toBeInTheDocument());
      const responseRegion = await screen.findByLabelText('Response body');
      const editorTextarea = within(responseRegion).getByTestId('monaco-editor-mock');
      expect(editorTextarea).toHaveValue('{\n  "hello": "world"\n}');
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('runs assertions against the response and reports verdicts', async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response('{"id":42}', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      await renderWithStore(<EditorPanel />);
      let id = '';
      act(() => {
        id = useWorkspaceStore.getState().addRequest(null);
        useWorkspaceStore.getState().setRequestAssertions(id, [
          { id: 'a1', kind: 'status', op: 'equals', expected: 200 },
          { id: 'a2', kind: 'json-path', op: 'equals', target: 'id', expected: 99 },
        ]);
      });
      await waitFor(() => screen.getByRole('button', { name: /Send/i }));
      await userEvent.click(screen.getByRole('button', { name: /Send/i }));
      await waitFor(() => expect(screen.getByText('200 OK')).toBeInTheDocument());
      // Click the Assertions tab in the response viewer (there are now two
      // "Assertions" tabs — the editor tab and the response-viewer tab).
      const assertionsTabs = screen.getAllByRole('tab', { name: /Assertions/i });
      // The response viewer's tab shows pass/fail counts in its label.
      const responseAssertionsTab = assertionsTabs.find((b) =>
        /\(1\/2\)/.test(b.textContent ?? ''),
      );
      expect(responseAssertionsTab).toBeDefined();
      await userEvent.click(responseAssertionsTab!);
      // Pass case now carries a positive explanation rather than the
      // literal word "Passed" — the response panel surfaces it directly.
      expect(screen.getByText('status: 200 equals 200')).toBeInTheDocument();
      expect(screen.getByText(/path "id".*expected 99, got 42/)).toBeInTheDocument();
    });

    it('linked-request edit flow: tree click opens editor, edits route to overrides, banner + Reset wired', async () => {
      // Seed a linked workspace with one request in its snapshot, then
      // simulate the tree click by setting activeLinkedRequest. The editor
      // should render the merged request (read-only fields editable in
      // the tabs); URL edits should land in linkedOverrides, NOT in
      // synced.collections.requests.
      await renderWithStore(<EditorPanel />);
      const synced = useWorkspaceStore.getState().synced!;
      const local = useWorkspaceStore.getState().local!;
      const linkId = 'lw-payments';
      const itemId = 'src-r1';
      const baseRequest = {
        id: itemId,
        name: 'Get user',
        folderId: null,
        method: 'GET' as const,
        url: 'https://source.example.test/users',
        headers: [],
        query: [],
        body: { type: 'none' as const, content: '' },
        auth: { type: 'none' as const },
        contextVars: [],
        extractions: [],
        assertions: [],
        createdAt: '2026-04-27T00:00:00.000Z',
        updatedAt: '2026-04-27T00:00:00.000Z',
      };
      act(() => {
        useWorkspaceStore.setState({
          synced: {
            ...synced,
            linkedWorkspaces: {
              [linkId]: {
                id: linkId,
                kind: 'private' as const,
                name: 'Payments',
                sourceWorkspaceId: 'src-ws-payments',
                source: {
                  provider: 'github' as const,
                  repoFullName: 'org/payments',
                  branch: 'main',
                  sessionMode: 'workspace' as const,
                },
                scope: ['collections' as const, 'environments' as const],
                pinnedVersion: '1.0.0',
                updatePolicy: 'manual' as const,
                linkedAt: '2026-04-27T00:00:00.000Z',
                requiredSecretKeyIds: [],
              },
            },
          },
          local: {
            ...local,
            linkedCollections: {
              [linkId]: {
                pulledAt: '2026-04-27T00:00:00.000Z',
                ref: 'v1.0.0',
                collections: {
                  tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: itemId }] },
                  requests: { [itemId]: baseRequest },
                  folders: {},
                },
                environments: { items: {}, activeName: null, priorityOrder: [] },
              },
            },
          },
        });
        useWorkspaceStore.getState().setActiveLinkedRequest({
          linkedWorkspaceId: linkId,
          itemId,
        });
      });

      // Editor renders the linked request's merged view, sourced from the
      // snapshot. URL field reflects the source URL; banner shows the link
      // metadata + "Source-clean" when there are no overrides yet.
      await waitFor(() => screen.getByLabelText('Request URL'));
      expect(screen.getByLabelText('Request URL')).toHaveValue('https://source.example.test/users');
      expect(screen.getByText(/Linked from/)).toBeInTheDocument();
      expect(screen.getByText('org/payments@main')).toBeInTheDocument();
      expect(screen.getByText('v1.0.0')).toBeInTheDocument();
      expect(screen.getByText(/Source-clean/)).toBeInTheDocument();

      // Edit the URL via the store (faster + more reliable than typing
      // through the autocomplete field). The store's setRequestUrl should
      // route to setLinkedRequestOverride because activeLinkedRequest is
      // set with the same itemId.
      act(() => {
        useWorkspaceStore.getState().setRequestUrl(itemId, 'https://staging.example.test/users');
      });

      const overrideKey = `${linkId}:${itemId}`;
      const overrideAfterEdit =
        useWorkspaceStore.getState().synced!.linkedOverrides.requests[overrideKey];
      expect(overrideAfterEdit).toBeDefined();
      expect(overrideAfterEdit.patch.url).toBe('https://staging.example.test/users');
      // The source's request inside the snapshot is untouched.
      const snapshotAfter =
        useWorkspaceStore.getState().local!.linkedCollections[linkId].collections.requests[itemId];
      expect(snapshotAfter.url).toBe('https://source.example.test/users');

      // Banner now reports "1 field locally modified" + a Reset button.
      expect(await screen.findByText(/1 field locally modified/)).toBeInTheDocument();
      // The per-field chip (#3) shows the overridden field name and acts as a
      // single-field reset trigger.
      const fieldChip = screen.getByRole('button', { name: /Reset url to source value/i });
      expect(fieldChip).toBeInTheDocument();
      const resetBtn = screen.getByRole('button', {
        name: /Reset all local modifications/i,
      });
      await userEvent.click(resetBtn);
      // After reset the override entry is gone — clean again.
      expect(
        useWorkspaceStore.getState().synced!.linkedOverrides.requests[overrideKey],
      ).toBeUndefined();
      await waitFor(() => expect(screen.getByText(/Source-clean/)).toBeInTheDocument());
    });

    it('per-field chip resets just that field, leaving other overrides intact', async () => {
      // Mirrors the seeding pattern in the linked-request edit-flow test
      // above so each test stays self-contained (no shared global fixture).
      await renderWithStore(<EditorPanel />);
      const synced = useWorkspaceStore.getState().synced!;
      const local = useWorkspaceStore.getState().local!;
      const linkId = 'lw-perfield';
      const itemId = 'src-r1';
      const baseRequest = {
        id: itemId,
        name: 'Get user',
        folderId: null,
        method: 'GET' as const,
        url: 'https://source.example.test/users',
        headers: [],
        query: [],
        body: { type: 'none' as const, content: '' },
        auth: { type: 'none' as const },
        contextVars: [],
        extractions: [],
        assertions: [],
        createdAt: '2026-04-27T00:00:00.000Z',
        updatedAt: '2026-04-27T00:00:00.000Z',
      };
      act(() => {
        useWorkspaceStore.setState({
          synced: {
            ...synced,
            linkedWorkspaces: {
              [linkId]: {
                id: linkId,
                kind: 'private' as const,
                name: 'Payments',
                sourceWorkspaceId: 'src-ws-payments',
                source: {
                  provider: 'github' as const,
                  repoFullName: 'org/payments',
                  branch: 'main',
                  sessionMode: 'workspace' as const,
                },
                scope: ['collections' as const, 'environments' as const],
                pinnedVersion: '1.0.0',
                updatePolicy: 'manual' as const,
                linkedAt: '2026-04-27T00:00:00.000Z',
                requiredSecretKeyIds: [],
              },
            },
          },
          local: {
            ...local,
            linkedCollections: {
              [linkId]: {
                pulledAt: '2026-04-27T00:00:00.000Z',
                ref: 'v1.0.0',
                collections: {
                  tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: itemId }] },
                  requests: { [itemId]: baseRequest },
                  folders: {},
                },
                environments: { items: {}, activeName: null, priorityOrder: [] },
              },
            },
          },
        });
        useWorkspaceStore.getState().setActiveLinkedRequest({
          linkedWorkspaceId: linkId,
          itemId,
        });
        // Layer two overrides: url + method.
        useWorkspaceStore.getState().setLinkedRequestOverride(linkId, itemId, {
          url: 'https://staging.example.test/users',
          method: 'POST',
        });
      });
      await waitFor(() =>
        expect(screen.getByText(/2 fields locally modified/)).toBeInTheDocument(),
      );
      // Click the `method` chip.
      await userEvent.click(screen.getByRole('button', { name: /Reset method to source value/i }));
      // The `url` override survives; `method` is gone.
      const remaining =
        useWorkspaceStore.getState().synced!.linkedOverrides.requests[`${linkId}:${itemId}`];
      expect(remaining.patch.url).toBe('https://staging.example.test/users');
      expect(remaining.patch.method).toBeUndefined();
      await waitFor(() => expect(screen.getByText(/1 field locally modified/)).toBeInTheDocument());
    });

    it('writes the run into local.history.requestRuns (capped buffer)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response('ok', { status: 200 }))),
      );
      await renderWithStore(<EditorPanel />);
      act(() => {
        useWorkspaceStore.getState().addRequest(null);
      });
      await waitFor(() => screen.getByRole('button', { name: /Send/i }));
      await userEvent.click(screen.getByRole('button', { name: /Send/i }));
      await waitFor(() =>
        expect(useWorkspaceStore.getState().local!.history.requestRuns.length).toBe(1),
      );
    });
  });
});
