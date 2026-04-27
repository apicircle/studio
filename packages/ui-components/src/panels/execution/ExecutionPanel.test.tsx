import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ExecutionPanel } from './ExecutionPanel';
import { ExecutionSidebar } from './ExecutionSidebar';

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
    const r1 = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestUrl(r1, 'https://x/a');
    const r2 = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestUrl(r2, 'https://x/b');
    const planId = useWorkspaceStore.getState().addPlan('orig');

    render(<ExecutionPanel />);
    expect(useWorkspaceStore.getState().local!.executionPlans[planId].name).toBe('orig');

    // Rename via the input. Clear-then-type races the controlled-component
    // re-render in jsdom, so use triple-click + type to fully replace the
    // value in one user-visible interaction.
    const nameInput = screen.getByLabelText('Plan name');
    await user.tripleClick(nameInput);
    await user.keyboard('Smoke');
    expect(useWorkspaceStore.getState().local!.executionPlans[planId].name).toBe('Smoke');

    // Add both requests as steps. Both seeded requests are auto-named
    // "New request", so we click the first match each time — addPlanStep
    // appends, so calling twice yields [r1, r2] in plan order regardless
    // of which row we picked.
    await user.click(screen.getByRole('button', { name: /Add step/ }));
    const pickerOptions = screen.getAllByRole('button', { name: /GET\s+New request/ });
    await user.click(pickerOptions[0]);
    await user.click(screen.getByRole('button', { name: /Add step/ }));
    const pickerOptions2 = screen.getAllByRole('button', { name: /GET\s+New request/ });
    await user.click(pickerOptions2[0]);
    expect(useWorkspaceStore.getState().local!.executionPlans[planId].steps).toHaveLength(2);

    // Move-up disabled on first row, move-down disabled on last.
    const moveUpButtons = screen.getAllByRole('button', { name: 'Move step up' });
    expect(moveUpButtons[0]).toBeDisabled();
    // Reorder: move first step down. Steps array swaps.
    const moveDownButtons = screen.getAllByRole('button', { name: 'Move step down' });
    const beforeOrder = useWorkspaceStore
      .getState()
      .local!.executionPlans[planId].steps.map((s) => s.requestId);
    await user.click(moveDownButtons[0]);
    const afterOrder = useWorkspaceStore
      .getState()
      .local!.executionPlans[planId].steps.map((s) => s.requestId);
    expect(afterOrder).toEqual([beforeOrder[1], beforeOrder[0]]);

    // Remove step 1.
    await user.click(screen.getAllByRole('button', { name: 'Remove step' })[0]);
    expect(useWorkspaceStore.getState().local!.executionPlans[planId].steps).toHaveLength(1);
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
    // The summary line appears once the run completes.
    expect(await screen.findByText(/1\/1 passed/)).toBeVisible();
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
    expect(useWorkspaceStore.getState().local!.executionPlans[planId].envPriorityOrder).toEqual([
      'dev',
      'prod',
    ]);

    // Move dev down via the per-row "Move dev down" button.
    await user.click(screen.getByRole('button', { name: /Move dev down/ }));
    expect(useWorkspaceStore.getState().local!.executionPlans[planId].envPriorityOrder).toEqual([
      'prod',
      'dev',
    ]);

    // Remove prod via its trash button.
    await user.click(screen.getByRole('button', { name: /Remove prod/ }));
    expect(useWorkspaceStore.getState().local!.executionPlans[planId].envPriorityOrder).toEqual([
      'dev',
    ]);
  });

  it('Run-with-assertions disables when there are no steps', async () => {
    useWorkspaceStore.getState().addPlan('p');
    render(<ExecutionPanel />);
    expect(screen.getByRole('button', { name: 'Run with assertions' })).toBeDisabled();
  });

  it('deleting the active plan falls back to the empty state', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.getState().addPlan('only');
    render(<ExecutionPanel />);
    await user.click(screen.getByLabelText('Delete plan'));
    expect(screen.getByText('No execution plans yet')).toBeInTheDocument();
  });
});

describe('ExecutionSidebar', () => {
  beforeEach(hydrate);

  it('renders an empty hint and a + button that creates a plan', async () => {
    render(<ExecutionSidebar />);
    expect(screen.getByText('No plans yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(Object.keys(useWorkspaceStore.getState().local!.executionPlans)).toHaveLength(1);
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

    await user.click(within(items[1]).getByRole('button'));
    expect(useWorkspaceStore.getState().activePlanId).toBe(a);
    void b;
  });

  it('falls through to the most-recent plan when the selection points at a deleted plan', () => {
    useWorkspaceStore.getState().addPlan('survives');
    useWorkspaceStore.setState({ activePlanId: 'phantom' });
    render(<ExecutionSidebar />);
    // The sidebar marks the surviving plan as active because the explicit
    // selection didn't resolve.
    const surviving = screen.getByRole('button', { name: /survives/ });
    expect(surviving).toHaveAttribute('aria-current', 'true');
  });
});
