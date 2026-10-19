import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RUN_HIDDEN_VALUE,
  type PlanRun,
  type RequestRun,
  type WorkspaceLocal,
} from '@apicircle/shared';
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
      // Plans now live on synced (not local) so they round-trip through Git.
      const next = useWorkspaceStore.getState().synced!;
      const plans = { ...(next.executionPlans ?? {}) };
      const plan = plans[newId];
      delete plans[newId];
      plans[id] = { ...plan, id };
      useWorkspaceStore.setState({ synced: { ...next, executionPlans: plans } });
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
          assertions: [
            { assertionId: 'a-1', kind: 'status', op: 'equals', expected: 200, passed: true },
          ],
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
            { assertionId: 'a-1', kind: 'status', op: 'equals', expected: 200, passed: false },
            { assertionId: 'a-2', kind: 'duration', op: 'lt', expected: 1000, passed: true },
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
    await userEvent.click(screen.getByRole('tab', { name: /^Headers$/ }));
    expect(screen.getByText('content-type')).toBeInTheDocument();
  });

  it('shows a hidden header value as "hidden" and says secrets were hidden', async () => {
    seedHistory({
      requestNames: { 'req-admin': 'Admin users' },
      requestRuns: [
        makeRun({
          id: 'run-h',
          requestId: 'req-admin',
          requestHeaders: { Authorization: RUN_HIDDEN_VALUE, Accept: 'application/json' },
          secretsHidden: true,
        }),
      ],
    });
    renderHistory();
    await userEvent.click(screen.getByText('Admin users'));

    expect(screen.getByRole('note')).toHaveTextContent(
      'Secrets were hidden before this run was saved: each value shown as hidden held one. Header names are kept.',
    );
    expect(screen.getByText('Authorization')).toBeInTheDocument();
    const hidden = screen.getByText('hidden');
    expect(hidden).toHaveAttribute('title', 'This value held a secret and was not saved');
    expect(screen.queryByText(RUN_HIDDEN_VALUE)).not.toBeInTheDocument();
    expect(screen.getByText('application/json')).toBeInTheDocument();
  });

  it('shows no notice for a run with nothing hidden', async () => {
    seedHistory({
      requestNames: { 'req-plain': 'Plain' },
      requestRuns: [makeRun({ id: 'run-p', requestId: 'req-plain' })],
    });
    renderHistory();
    await userEvent.click(screen.getByText('Plain'));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('HistoryPanel — plan rows', () => {
  it('says secrets were hidden inside an expanded plan step', async () => {
    await hydrate();
    seedHistory({
      requestNames: { 'req-step': 'Step one' },
      requestRuns: [
        makeRun({ id: 'run-step', requestId: 'req-step', secretsHidden: true }),
        makeRun({ id: 'run-plain', requestId: 'req-step' }),
      ],
      planNames: { 'plan-h': 'Admin plan' },
      planRuns: [
        {
          id: 'pr-h',
          planId: 'plan-h',
          startedAt: '2026-04-27T12:00:00.000Z',
          durationMs: 10,
          withAssertions: false,
          steps: [
            { requestRunId: 'run-step', passed: true },
            { requestRunId: 'run-plain', passed: true },
          ],
        },
      ],
    });
    renderHistory();
    await userEvent.click(screen.getByRole('tab', { name: /^Plans/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Plan run "Admin plan" details' }));
    const [hiddenStep, plainStep] = screen.getAllByRole('button', { name: /Step one/ });
    await userEvent.click(plainStep);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    await userEvent.click(hiddenStep);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Secrets were hidden before this run was saved',
    );
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

  it('per-row delete removes only that run after confirmation', async () => {
    seedTwoRuns();
    renderHistory();
    const dropRow = screen.getByText('Drop me').closest('li');
    if (!dropRow) throw new Error('row not found');
    // Trash icon now opens a ConfirmDialog (audit fix: per-row delete
    // wasn't confirmed even though Clear All was — inconsistent).
    await userEvent.click(within(dropRow).getByRole('button', { name: /Delete request run/i }));
    expect(screen.getByText('Drop me')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete run' }));
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

describe('HistoryPanel — replaying and opening a run', () => {
  beforeEach(hydrate);

  it('replays a run and opens its request while the request exists', async () => {
    const replayRequestRun = vi.fn().mockResolvedValue(undefined);
    seedHistory({
      requestNames: { 'req-known': 'Get user' },
      requestRuns: [makeRun({ id: 'run-1', requestId: 'req-known' })],
    });
    act(() => useWorkspaceStore.setState({ replayRequestRun }));
    renderHistory();
    const replay = screen.getByRole('button', { name: /^Replay request run from/ });
    expect(replay).toHaveAttribute('title', expect.stringMatching(/^Replay this request/));
    await userEvent.click(replay);
    expect(replayRequestRun).toHaveBeenCalledWith('run-1');

    const open = screen.getByRole('button', { name: 'Open source request in Editor' });
    expect(open).toHaveAttribute('title', 'Open Get user in the Editor');
    await userEvent.click(open);
    expect(useWorkspaceStore.getState().activePanel).toBe('editor');
    expect(useWorkspaceStore.getState().local!.ui.activeRequestId).toBe('req-known');
  });

  it('says why a run whose request was deleted can be neither replayed nor opened', () => {
    seedHistory({ requestRuns: [makeRun({ id: 'run-2', requestId: 'gone' })] });
    renderHistory();
    const replay = screen.getByRole('button', { name: /^Replay request run from/ });
    expect(replay).toBeDisabled();
    expect(replay).toHaveAccessibleDescription(
      'The request this run came from was deleted, so it cannot be sent again.',
    );
    expect(replay).not.toHaveAttribute('title');
    const open = screen.getByRole('button', { name: 'Open source request in Editor' });
    expect(open).toBeDisabled();
    expect(open).toHaveAccessibleDescription('The request this run came from was deleted.');
  });
});
