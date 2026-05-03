import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlanRun, RequestRun, WorkspaceLocal } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { HistoryPanel } from './HistoryPanel';
import { HistorySidebar } from './HistorySidebar';

/**
 * The real layout puts `HistorySidebar` (filters, tabs, search, date range)
 * in the global sidebar slot and `HistoryPanel` (run list + detail) in the
 * main area. Tests render them together so the same DOM tree is exercised.
 */
function renderHistory() {
  return render(
    <div className="flex h-full">
      <HistorySidebar />
      <HistoryPanel />
    </div>,
  );
}

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

/** Build a RequestRun fixture, defaulting the wire-detail fields the new
 * History detail view reads. */
function makeRun(overrides: Partial<RequestRun>): RequestRun {
  return {
    id: 'run',
    requestId: 'req',
    startedAt: '2026-04-27T12:00:00.000Z',
    durationMs: 1,
    status: 200,
    statusText: 'OK',
    ok: true,
    url: 'https://api.example.com/x',
    method: 'GET',
    requestHeaders: {},
    requestBodyPreview: null,
    responseHeaders: {},
    responseBodyPreview: '',
    responseBodyKind: 'empty',
    responseTruncated: false,
    assertions: [],
    ...overrides,
  };
}

function seedHistory(args: {
  requestRuns?: RequestRun[];
  planRuns?: PlanRun[];
  requestNames?: Record<string, string>;
  planNames?: Record<string, string>;
}): void {
  const local = useWorkspaceStore.getState().local!;
  if (args.requestNames) {
    for (const [id, name] of Object.entries(args.requestNames)) {
      const newId = useWorkspaceStore.getState().addRequest(null, name);
      // Patch the request id so it matches the run record.
      const synced = useWorkspaceStore.getState().synced!;
      const req = synced.collections.requests[newId];
      const requests = { ...synced.collections.requests };
      delete requests[newId];
      requests[id] = { ...req, id, name };
      useWorkspaceStore.setState({
        synced: { ...synced, collections: { ...synced.collections, requests } },
      });
    }
  }
  if (args.planNames) {
    for (const [id, name] of Object.entries(args.planNames)) {
      const newId = useWorkspaceStore.getState().addPlan(name);
      const next = useWorkspaceStore.getState().local!;
      const plans = { ...next.executionPlans };
      const plan = plans[newId];
      delete plans[newId];
      plans[id] = { ...plan, id };
      useWorkspaceStore.setState({ local: { ...next, executionPlans: plans } });
    }
  }
  const next: WorkspaceLocal = {
    ...useWorkspaceStore.getState().local!,
    history: {
      requestRuns: args.requestRuns ?? local.history.requestRuns,
      planRuns: args.planRuns ?? local.history.planRuns,
    },
  };
  useWorkspaceStore.setState({ local: next });
}

describe('HistoryPanel — empty states', () => {
  beforeEach(hydrate);

  it('renders the Requests empty hint by default', () => {
    renderHistory();
    expect(screen.getByText(/No request runs yet/)).toBeInTheDocument();
  });

  it('switches to the Plans tab and shows its empty hint', async () => {
    renderHistory();
    await userEvent.click(screen.getByRole('tab', { name: /^Plans/ }));
    expect(screen.getByText(/No plan runs yet/)).toBeInTheDocument();
  });
});

describe('HistoryPanel — request rows', () => {
  beforeEach(hydrate);

  it('renders one row per request run with status, duration, and assertion verdict', () => {
    seedHistory({
      requestNames: { 'req-known': 'Get user' },
      requestRuns: [
        makeRun({
          id: 'run-1',
          requestId: 'req-known',
          method: 'GET',
          status: 200,
          ok: true,
          durationMs: 42,
          assertions: [{ assertionId: 'a-1', passed: true }],
        }),
        makeRun({
          id: 'run-2',
          requestId: 'deleted-id',
          method: 'POST',
          status: 500,
          ok: false,
          durationMs: 99,
          statusText: 'Server Error',
          assertions: [
            { assertionId: 'a-1', passed: false },
            { assertionId: 'a-2', passed: true },
          ],
        }),
      ],
    });
    renderHistory();
    expect(screen.getByText('Get user')).toBeInTheDocument();
    expect(screen.getByText('deleted request')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('clicking a row opens the inline detail block with request + response sections', async () => {
    seedHistory({
      requestNames: { 'req-known': 'Get user' },
      requestRuns: [
        makeRun({
          id: 'run-1',
          requestId: 'req-known',
          status: 200,
          ok: true,
          url: 'https://api.example.com/users/42',
          method: 'GET',
          requestHeaders: { 'X-Auth': 'token' },
          responseHeaders: { 'content-type': 'application/json' },
          responseBodyPreview: '{"id":42}',
          responseBodyKind: 'json',
        }),
      ],
    });
    renderHistory();
    await userEvent.click(screen.getByText('Get user'));
    expect(screen.getByText('https://api.example.com/users/42')).toBeInTheDocument();
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText('Response')).toBeInTheDocument();
    // Request column still shows the captured request headers inline.
    expect(screen.getByText('X-Auth')).toBeInTheDocument();
    // Response side is now the same ResponseViewer used in the Editor —
    // the body editor is loaded with the captured wire body, and response
    // headers move behind the Headers tab.
    const bodyEditor = within(screen.getByLabelText('Response body')).getByTestId(
      'monaco-editor-mock',
    );
    expect(bodyEditor).toHaveValue('{\n  "id": 42\n}');
    await userEvent.click(screen.getByRole('button', { name: /^Headers$/ }));
    expect(screen.getByText('content-type')).toBeInTheDocument();
  });
});

describe('HistoryPanel — plan rows', () => {
  beforeEach(hydrate);

  it('shows plan summaries with okCount/total + the assertions tag when applicable', async () => {
    seedHistory({
      planNames: { 'plan-known': 'Smoke checks' },
      planRuns: [
        {
          id: 'pr-1',
          planId: 'plan-known',
          startedAt: '2026-04-27T12:00:00.000Z',
          durationMs: 120,
          withAssertions: true,
          steps: [
            { requestRunId: 'run-1', passed: true },
            { requestRunId: 'run-2', passed: true },
          ],
        },
        {
          id: 'pr-2',
          planId: 'gone',
          startedAt: '2026-04-27T12:00:00.000Z',
          durationMs: 200,
          withAssertions: false,
          steps: [
            { requestRunId: 'run-3', passed: true },
            { requestRunId: 'run-4', passed: false },
          ],
        },
      ],
    });
    renderHistory();
    await userEvent.click(screen.getByRole('tab', { name: /^Plans/ }));

    expect(screen.getByText('Smoke checks')).toBeInTheDocument();
    expect(screen.getByText('deleted plan')).toBeInTheDocument();
    expect(screen.getByText('2/2 req')).toBeInTheDocument();
    expect(screen.getByText('1/2 req')).toBeInTheDocument();
    // Assertion-tally chip shows up only on runs launched with assertions.
    // Test fixtures have no child assertion records, so the tally is 0/0.
    expect(screen.getByText('0/0 ✓')).toBeInTheDocument();
  });
});

describe('HistoryPanel — clear history', () => {
  beforeEach(hydrate);

  function seedTwoRuns() {
    seedHistory({
      requestNames: { 'r-keep': 'Keep me', 'r-drop': 'Drop me' },
      requestRuns: [
        makeRun({
          id: 'run-keep',
          requestId: 'r-keep',
          method: 'GET',
          status: 200,
          ok: true,
        }),
        makeRun({
          id: 'run-drop',
          requestId: 'r-drop',
          method: 'POST',
          status: 500,
          ok: false,
        }),
      ],
    });
  }

  it('per-row delete removes only that run', async () => {
    seedTwoRuns();
    renderHistory();
    const dropRow = screen.getByText('Drop me').closest('li');
    if (!dropRow) throw new Error('row not found');
    await userEvent.click(within(dropRow).getByRole('button', { name: /Delete request run/i }));
    expect(screen.queryByText('Drop me')).not.toBeInTheDocument();
    expect(screen.getByText('Keep me')).toBeInTheDocument();
    const remaining = useWorkspaceStore.getState().local!.history.requestRuns;
    expect(remaining.map((r) => r.id)).toEqual(['run-keep']);
  });

  it('Clear all wipes every request run after confirmation', async () => {
    seedTwoRuns();
    renderHistory();
    await userEvent.click(screen.getByRole('button', { name: /^Clear all$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(useWorkspaceStore.getState().local!.history.requestRuns).toEqual([]);
    expect(screen.getByText(/No request runs yet/)).toBeInTheDocument();
  });

  it('Clear matching wipes only filtered rows', async () => {
    seedTwoRuns();
    renderHistory();
    const filterInput = screen.getByLabelText('Filter by search');
    await userEvent.type(filterInput, 'Drop');
    await userEvent.click(screen.getByRole('button', { name: /^Clear matching/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    const remaining = useWorkspaceStore.getState().local!.history.requestRuns;
    expect(remaining.map((r) => r.id)).toEqual(['run-keep']);
  });

  it('Clear button is disabled when there are no runs', () => {
    renderHistory();
    expect(screen.getByRole('button', { name: /^Clear all$/ })).toBeDisabled();
  });

  it('status filter chips narrow the list', async () => {
    seedTwoRuns();
    renderHistory();
    // Click the 5xx chip — only the Drop me (500) row should remain visible.
    await userEvent.click(screen.getByRole('button', { name: '5xx' }));
    expect(screen.queryByText('Keep me')).not.toBeInTheDocument();
    expect(screen.getByText('Drop me')).toBeInTheDocument();
  });
});

describe('HistoryPanel — tab counters', () => {
  beforeEach(hydrate);

  it('shows the run count next to each tab label', () => {
    seedHistory({
      requestRuns: [makeRun({ id: 'r', requestId: 'x', method: 'GET', status: 200, ok: true })],
      planRuns: [
        {
          id: 'p',
          planId: 'y',
          startedAt: 't',
          durationMs: 1,
          withAssertions: false,
          steps: [],
        },
      ],
    });
    renderHistory();
    const tabs = screen.getAllByRole('tab');
    expect(within(tabs[0]).getByText('(1)')).toBeInTheDocument();
    expect(within(tabs[1]).getByText('(1)')).toBeInTheDocument();
  });
});
