import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ExecutionPanel } from './ExecutionPanel';
import { ExecutionSidebar, ExecutionSidebarActions } from './ExecutionSidebar';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

describe('ExecutionPanel — empty state', () => {
  beforeEach(hydrate);

  it('shows the empty-state CTA when no plans exist', async () => {
    render(<ExecutionPanel />);
    expect(screen.getByText('No execution plans yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    // After creating, the empty state disappears and the editor renders
    // (with the auto-named "Untitled plan" focused).
    expect(screen.queryByText('No execution plans yet')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Plan name')).toHaveValue('Untitled plan');
  });
});

describe('ExecutionPanel — plan editor', () => {
  beforeEach(hydrate);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renames a plan, adds + reorders + removes steps', async () => {
    const user = userEvent.setup();
    // Seed two requests so the picker has something to show.
    const r1 = useWorkspaceStore.getState().addRequest(null, 'first');
    useWorkspaceStore.getState().setRequestUrl(r1, 'https://x/a');
    const r2 = useWorkspaceStore.getState().addRequest(null, 'second');
    useWorkspaceStore.getState().setRequestUrl(r2, 'https://x/b');
    const planId = useWorkspaceStore.getState().addPlan('orig');

    render(<ExecutionPanel />);
    expect(useWorkspaceStore.getState().synced!.executionPlans![planId].name).toBe('orig');

    // Rename via the input. fireEvent.change replaces the value in one
    // shot, avoiding the per-keystroke cost of tripleClick + keyboard —
    // keeps the test inside the default 5s timeout under parallel load.
    const nameInput = screen.getByLabelText('Plan name');
    fireEvent.change(nameInput, { target: { value: 'Smoke' } });
    expect(useWorkspaceStore.getState().synced!.executionPlans![planId].name).toBe('Smoke');

    // Open the multi-select picker and add both requests in one shot. Verifies
    // bulk-add: a single Add steps click commits all selections.
    await user.click(screen.getByRole('button', { name: /Add step/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Select first' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select second' }));
    await user.click(screen.getByRole('button', { name: /Add 2 steps/ }));
    expect(useWorkspaceStore.getState().synced!.executionPlans![planId].steps).toHaveLength(2);

    // Move-up disabled on first row, move-down disabled on last.
    const moveUpButtons = screen.getAllByRole('button', { name: 'Move step up' });
    expect(moveUpButtons[0]).toBeDisabled();
    // Reorder: move first step down. Steps array swaps.
    const moveDownButtons = screen.getAllByRole('button', { name: 'Move step down' });
    const beforeOrder = useWorkspaceStore
      .getState()
      .synced!.executionPlans![planId].steps.map((s) => s.requestId);
    await user.click(moveDownButtons[0]);
    const afterOrder = useWorkspaceStore
      .getState()
      .synced!.executionPlans![planId].steps.map((s) => s.requestId);
    expect(afterOrder).toEqual([beforeOrder[1], beforeOrder[0]]);

    // Remove step 1.
    await user.click(screen.getAllByRole('button', { name: 'Remove step' })[0]);
    expect(useWorkspaceStore.getState().synced!.executionPlans![planId].steps).toHaveLength(1);
  });

  it('runs a plan and surfaces the pass/fail summary', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })),
    );
    const r1 = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestUrl(r1, 'https://x/a');
    const planId = useWorkspaceStore.getState().addPlan('p');
    useWorkspaceStore.getState().addPlanStep(planId, r1);

    render(<ExecutionPanel />);
    await user.click(screen.getByRole('button', { name: /^Run$/ }));
    // Verdict label now disambiguates HTTP success from assertion verdicts;
    // a no-assertions Run shows just the request-success tally.
    expect(await screen.findByText(/1\/1 requests succeeded/)).toBeVisible();
  });

  it('surfaces an error when the run rejects', async () => {
    const user = userEvent.setup();
    const planId = useWorkspaceStore.getState().addPlan('p');
    const r1 = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().addPlanStep(planId, r1);
    // Force runPlan to throw by stubbing the action.
    useWorkspaceStore.setState({
      runPlan: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    render(<ExecutionPanel />);
    await user.click(screen.getByRole('button', { name: /^Run$/ }));
    expect(await screen.findByText(/boom/)).toBeVisible();
  });

  it('plan-level env priority editor adds, reorders, and removes envs', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.getState().addEnvironment('dev');
    useWorkspaceStore.getState().addEnvironment('prod');
    const planId = useWorkspaceStore.getState().addPlan('p');

    render(<ExecutionPanel />);
    // Both env names appear as add-buttons under "Plan-level env priority".
    expect(screen.getByText(/No plan-level priority/)).toBeInTheDocument();

    // The "+ dev" / "+ prod" buttons render an icon + text; the accessible
    // name is just the env name. Match by exact text content.
    await user.click(screen.getByRole('button', { name: 'dev' }));
    await user.click(screen.getByRole('button', { name: 'prod' }));
    expect(useWorkspaceStore.getState().synced!.executionPlans![planId].envPriorityOrder).toEqual([
      { kind: 'local', name: 'dev' },
      { kind: 'local', name: 'prod' },
    ]);

    // Move dev down via the per-row "Move dev down" button.
    await user.click(screen.getByRole('button', { name: /Move dev down/ }));
    expect(useWorkspaceStore.getState().synced!.executionPlans![planId].envPriorityOrder).toEqual([
      { kind: 'local', name: 'prod' },
      { kind: 'local', name: 'dev' },
    ]);

    // Remove prod via its trash button.
    await user.click(screen.getByRole('button', { name: /Remove prod/ }));
    expect(useWorkspaceStore.getState().synced!.executionPlans![planId].envPriorityOrder).toEqual([
      { kind: 'local', name: 'dev' },
    ]);
  });

  it('Run-with-assertions disables when there are no steps', async () => {
    useWorkspaceStore.getState().addPlan('p');
    render(<ExecutionPanel />);
    expect(screen.getByRole('button', { name: 'Run with assertions' })).toBeDisabled();
  });

  it('deleting the active plan falls back to the empty state', async () => {
    // Plan-level delete moved into the ExecutionSidebar kebab in the
    // minor-fixes pass. Render both panels so we can drive the kebab and
    // verify the main pane reacts.
    const user = userEvent.setup();
    useWorkspaceStore.getState().addPlan('only');
    render(
      <>
        <ExecutionSidebar />
        <ExecutionPanel />
      </>,
    );
    await user.click(screen.getByLabelText('only actions'));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('No execution plans yet')).toBeInTheDocument();
  });
});

describe('ExecutionPanel — per-step run details', () => {
  beforeEach(hydrate);

  it('renders one collapsible row per step with status, duration, and assertion verdict', async () => {
    const planId = useWorkspaceStore.getState().addPlan('p');
    useWorkspaceStore.setState({
      lastPlanResults: {
        [planId]: [
          {
            requestName: 'Get user',
            requestMethod: 'GET',
            passed: true,
            assertionResults: [
              {
                assertionId: 'a-1',
                kind: 'status',
                op: 'equals',
                expected: 200,
                passed: true,
                detail: 'ok',
              },
            ],
            result: {
              startedAt: 't',
              durationMs: 42,
              status: 200,
              ok: true,
              statusText: 'OK',
              headers: { 'content-type': 'application/json' },
              body: '{"id":1}',
              bodyKind: 'json',
              url: 'https://api.test/users/1',
              method: 'GET',
              authWarnings: [],
            },
          },
          {
            requestName: 'Update user',
            requestMethod: 'PUT',
            passed: false,
            assertionResults: [
              {
                assertionId: 'a-1',
                kind: 'status',
                op: 'equals',
                expected: 200,
                passed: false,
                detail: 'expected 200, got 500',
              },
            ],
            result: {
              startedAt: 't',
              durationMs: 999,
              status: 500,
              ok: false,
              statusText: 'Internal',
              headers: {},
              body: '',
              bodyKind: 'empty',
              url: 'https://api.test/users/1',
              method: 'PUT',
              authWarnings: [],
            },
          },
        ],
      },
    });
    useWorkspaceStore.setState({ activePlanId: planId });
    render(<ExecutionPanel />);

    expect(screen.getByText('Last run · per-step details')).toBeInTheDocument();
    expect(screen.getByText('Get user')).toBeInTheDocument();
    expect(screen.getByText('Update user')).toBeInTheDocument();
    // First row is open by default — should show URL.
    expect(screen.getAllByText('https://api.test/users/1').length).toBeGreaterThan(0);
    // Click to open the second row.
    await userEvent.click(screen.getByRole('button', { expanded: false, name: /Update user/ }));
    // Assertion detail now lives in the ResponseViewer's Assertions tab
    // (matching the editor's request-execution view); switch to it.
    const assertionsTabs = screen.getAllByRole('button', { name: /Assertions \(0\/1\)/ });
    await userEvent.click(assertionsTabs[assertionsTabs.length - 1]);
    expect(screen.getByText('expected 200, got 500')).toBeInTheDocument();
  });
});

describe('ExecutionSidebar', () => {
  beforeEach(hydrate);

  it('renders an empty hint and a kebab "Add plan" entry that creates a plan', async () => {
    const user = userEvent.setup();
    // The "Add plan" kebab now lives in the shared sidebar header
    // (rendered by Sidebar.tsx) — exercise it via ExecutionSidebarActions.
    render(
      <>
        <ExecutionSidebarActions />
        <ExecutionSidebar />
      </>,
    );
    expect(screen.getByText('No plans yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Execution actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Add plan' }));
    expect(Object.keys(useWorkspaceStore.getState().synced!.executionPlans!)).toHaveLength(1);
  });

  it('lists plans newest-first and lets the user select one', async () => {
    const user = userEvent.setup();
    const a = useWorkspaceStore.getState().addPlan('plan-a');
    // Bump updatedAt on plan-b so it sorts above plan-a.
    await new Promise((r) => setTimeout(r, 5));
    const b = useWorkspaceStore.getState().addPlan('plan-b');

    render(<ExecutionSidebar />);
    const items = screen.getAllByRole('listitem');
    // The sort key is updatedAt desc — plan-b is the newer one.
    expect(within(items[0]).getByText('plan-b')).toBeInTheDocument();
    expect(within(items[1]).getByText('plan-a')).toBeInTheDocument();

    // Each row now has two buttons (plan + kebab). The first one is the
    // plan-select button; the kebab carries `aria-haspopup="menu"`.
    await user.click(within(items[1]).getAllByRole('button')[0]);
    expect(useWorkspaceStore.getState().activePlanId).toBe(a);
    void b;
  });

  it('falls through to the most-recent plan when the selection points at a deleted plan', () => {
    useWorkspaceStore.getState().addPlan('survives');
    useWorkspaceStore.setState({ activePlanId: 'phantom' });
    render(<ExecutionSidebar />);
    // The sidebar marks the surviving plan-button as active because the
    // explicit selection didn't resolve. The plan row has two buttons (plan
    // + kebab); the plan button is the one carrying aria-current.
    const surviving = screen.getByText('survives').closest('button');
    expect(surviving).not.toBeNull();
    expect(surviving).toHaveAttribute('aria-current', 'true');
  });
});
