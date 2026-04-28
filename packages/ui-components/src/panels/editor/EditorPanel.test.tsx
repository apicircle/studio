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

    it('persists the renamed request through the store', async () => {
      const input = screen.getByLabelText('Request name');
      await userEvent.clear(input);
      await userEvent.type(input, 'Get user');
      expect(useWorkspaceStore.getState().synced!.collections.requests[id].name).toBe('Get user');
    });

    it('switches HTTP method through the dropdown', async () => {
      await userEvent.selectOptions(screen.getByLabelText('HTTP method'), 'POST');
      expect(useWorkspaceStore.getState().synced!.collections.requests[id].method).toBe('POST');
    });

    it('selecting body type "json" appends a Content-Type header', async () => {
      await userEvent.click(screen.getByRole('button', { name: /^Body/ }));
      await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
      const headers = useWorkspaceStore.getState().synced!.collections.requests[id].headers;
      expect(headers).toContainEqual({
        key: 'Content-Type',
        value: 'application/json',
        enabled: true,
      });
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
      // "Assertions" buttons — the editor tab and the response-viewer tab).
      const assertionsTabs = screen.getAllByRole('button', { name: /Assertions/i });
      // The response viewer's tab shows pass/fail counts in its label.
      const responseAssertionsTab = assertionsTabs.find((b) =>
        /\(1\/2\)/.test(b.textContent ?? ''),
      );
      expect(responseAssertionsTab).toBeDefined();
      await userEvent.click(responseAssertionsTab!);
      expect(screen.getByText('Passed')).toBeInTheDocument();
      expect(screen.getByText(/path "id".*expected 99, got 42/)).toBeInTheDocument();
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
