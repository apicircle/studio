import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlanRun, RequestRun, WorkspaceLocal } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { HistoryPanel } from './HistoryPanel';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

function seedHistory(args: {
  requestRuns?: RequestRun[];
  planRuns?: PlanRun[];
  requestNames?: Record<string, string>;
  planNames?: Record<string, string>;
}): void {
  const local = useWorkspaceStore.getState().local!;
  // Optionally seed requests so the History rows can resolve names.
  if (args.requestNames) {
    for (const [id, name] of Object.entries(args.requestNames)) {
      const newId = useWorkspaceStore.getState().addRequest(null);
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
    render(<HistoryPanel />);
    expect(screen.getByText(/No request runs yet/)).toBeInTheDocument();
  });

  it('switches to the Plans tab and shows its empty hint', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: /^Plans/ }));
    expect(screen.getByText(/No plan runs yet/)).toBeInTheDocument();
  });
});

describe('HistoryPanel — request rows', () => {
  beforeEach(hydrate);

  it('renders one row per request run with status, duration, and assertion verdict', () => {
    seedHistory({
      requestNames: { 'req-known': 'Get user' },
      requestRuns: [
        {
          id: 'run-1',
          requestId: 'req-known',
          startedAt: '2026-04-27T12:00:00.000Z',
          durationMs: 42,
          status: 200,
          ok: true,
          assertions: [{ assertionId: 'a-1', passed: true }],
        },
        {
          id: 'run-2',
          requestId: 'deleted-id',
          startedAt: '2026-04-27T12:00:00.000Z',
          durationMs: 99,
          status: 500,
          ok: false,
          assertions: [
            { assertionId: 'a-1', passed: false },
            { assertionId: 'a-2', passed: true },
          ],
        },
      ],
    });
    render(<HistoryPanel />);
    expect(screen.getByText('Get user')).toBeInTheDocument();
    // Deleted request renders as italic placeholder.
    expect(screen.getByText('deleted request')).toBeInTheDocument();
    // Status codes appear.
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    // Assertion badges: 1/1 passes (success), 1/2 fails (warning).
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
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
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: /^Plans/ }));

    expect(screen.getByText('Smoke checks')).toBeInTheDocument();
    expect(screen.getByText('deleted plan')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    // The `assertions` tag only renders when withAssertions is true.
    const assertionsTags = screen.getAllByText('assertions');
    expect(assertionsTags).toHaveLength(1);
  });
});

describe('HistoryPanel — clear history', () => {
  beforeEach(hydrate);

  function seedTwoRuns() {
    seedHistory({
      requestNames: { 'r-keep': 'Keep me', 'r-drop': 'Drop me' },
      requestRuns: [
        {
          id: 'run-keep',
          requestId: 'r-keep',
          startedAt: '2026-04-27T12:00:00.000Z',
          durationMs: 1,
          status: 200,
          ok: true,
          assertions: [],
        },
        {
          id: 'run-drop',
          requestId: 'r-drop',
          startedAt: '2026-04-27T12:00:00.000Z',
          durationMs: 1,
          status: 500,
          ok: false,
          assertions: [],
        },
      ],
    });
  }

  it('per-row delete removes only that run', async () => {
    seedTwoRuns();
    render(<HistoryPanel />);
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
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: /^Clear all$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(useWorkspaceStore.getState().local!.history.requestRuns).toEqual([]);
    expect(screen.getByText(/No request runs yet/)).toBeInTheDocument();
  });

  it('Clear matching wipes only filtered rows', async () => {
    seedTwoRuns();
    render(<HistoryPanel />);
    const filterInput = screen.getByLabelText('Filter history');
    await userEvent.type(filterInput, 'Drop');
    await userEvent.click(screen.getByRole('button', { name: /^Clear matching/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    const remaining = useWorkspaceStore.getState().local!.history.requestRuns;
    expect(remaining.map((r) => r.id)).toEqual(['run-keep']);
  });

  it('Clear button is disabled when there are no runs', () => {
    render(<HistoryPanel />);
    expect(screen.getByRole('button', { name: /^Clear all$/ })).toBeDisabled();
  });
});

describe('HistoryPanel — tab counters', () => {
  beforeEach(hydrate);

  it('shows the run count next to each tab label', () => {
    seedHistory({
      requestRuns: [
        {
          id: 'r',
          requestId: 'x',
          startedAt: 't',
          durationMs: 1,
          status: 200,
          ok: true,
          assertions: [],
        },
      ],
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
    render(<HistoryPanel />);
    const tabs = screen.getAllByRole('button', { name: /^(Requests|Plans)/ });
    expect(within(tabs[0]).getByText('(1)')).toBeInTheDocument();
    expect(within(tabs[1]).getByText('(1)')).toBeInTheDocument();
  });
});
