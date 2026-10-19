import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { renderWithStore } from '../../../test/renderWithStore';
import { ExecutionPanel } from './ExecutionPanel';

// The plan editor's controls say why they are off (STU-UX-16), its Run bar is
// sticky (STU-UX-18), and its environment copy is plain (STU-UX-11).

const RUNNING = 'The plan is running. Wait for it to finish, or cancel it.';

const plan = () => Object.values(useWorkspaceStore.getState().synced!.executionPlans!)[0];

describe('A plan with nothing in it', () => {
  it('says Run waits for a step, and Add step for a request', async () => {
    await renderWithStore(<ExecutionPanel />);
    act(() => {
      useWorkspaceStore.getState().addPlan('Empty');
    });
    expect(screen.getByRole('button', { name: /^Run$/ })).toHaveAccessibleDescription(
      'Add a step first.',
    );
    expect(screen.getByRole('button', { name: 'Run with assertions' })).toHaveAccessibleDescription(
      'Add a step first.',
    );
    expect(screen.getByRole('button', { name: 'Add step' })).toHaveAccessibleDescription(
      'Add a request in the Editor first.',
    );
    // The Run controls sit in a sticky bar at the foot of the panel.
    expect(screen.getByTestId('plan-run-bar')).toHaveClass('sticky', '-bottom-6');
    expect(screen.getByRole('region', { name: 'Run plan' })).toBeInTheDocument();
  });
});

describe('A plan with steps', () => {
  let ids: { a: string; b: string; planId: string };

  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
    act(() => {
      const store = useWorkspaceStore.getState();
      const a = store.addRequest(null, 'first');
      const b = store.addRequest(null, 'second');
      const planId = store.addPlan('Two');
      store.addPlanStep(planId, a);
      store.addPlanStep(planId, b);
      store.addEnvironment('dev');
      store.addEnvironment('prod');
      store.setPlanEnvPriority(planId, [
        { kind: 'local', name: 'dev' },
        { kind: 'local', name: 'prod' },
      ]);
      ids = { a, b, planId };
    });
  });

  it('turns a step off, and says why the ends of the list cannot move further', async () => {
    render(<ExecutionPanel />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable step 1' }));
    expect(plan().steps[0].enabled).toBe(false);
    const ups = screen.getAllByRole('button', { name: 'Move step up' });
    const downs = screen.getAllByRole('button', { name: 'Move step down' });
    expect(ups[0]).toHaveAccessibleDescription('This step is first already.');
    expect(downs[1]).toHaveAccessibleDescription('This step is last already.');
  });

  it('reorders the plan’s environments, and says which end each is at', async () => {
    render(<ExecutionPanel />);
    expect(screen.getByRole('button', { name: 'Move dev up' })).toHaveAccessibleDescription(
      'This environment is checked first already.',
    );
    expect(screen.getByRole('button', { name: 'Move prod down' })).toHaveAccessibleDescription(
      'This environment is checked last already.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move prod up' }));
    expect(plan().envPriorityOrder.map((r) => (r.kind === 'local' ? r.name : ''))).toEqual([
      'prod',
      'dev',
    ]);
    expect(screen.getByText('Environments for this plan')).toBeInTheDocument();
  });

  it('locks every step control while the plan runs, and says so on each', async () => {
    const runPlan = vi.fn(() => new Promise<never>(() => {}));
    act(() => useWorkspaceStore.setState({ runPlan }));
    render(<ExecutionPanel />);
    await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    expect(runPlan).toHaveBeenCalledWith(ids.planId, { withAssertions: false });
    for (const control of [
      screen.getByRole('checkbox', { name: 'Enable step 1' }),
      screen.getAllByRole('button', { name: 'Move step up' })[1],
      screen.getAllByRole('button', { name: 'Move step down' })[0],
      screen.getAllByRole('button', { name: 'Remove step' })[0],
      screen.getByRole('button', { name: 'Add step' }),
      screen.getByRole('button', { name: 'Run with assertions' }),
    ]) {
      expect(control).toBeDisabled();
      expect(control).toHaveAccessibleDescription(RUNNING);
    }
    // The button that started it says what it is doing instead.
    expect(screen.getByRole('button', { name: 'Running…' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });
});
