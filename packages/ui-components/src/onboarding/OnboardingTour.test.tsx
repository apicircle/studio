import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { OnboardingTour, replayOnboarding } from './OnboardingTour';

const DONE_KEY = 'apicircle:onboarding-tour-done-v2';

describe('OnboardingTour', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('auto-starts on first run and shows the welcome step', () => {
    render(<OnboardingTour />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Welcome to API Circle Studio');
    expect(dialog).toHaveTextContent(/Quick tour · 1 of \d+/);
  });

  it('advances and rewinds through steps', async () => {
    const user = userEvent.setup();
    render(<OnboardingTour />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Welcome to API Circle Studio');
    // The first step has nothing to go back to.
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Nine panels, one per workflow');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Welcome to API Circle Studio');
  });

  it('skipping marks the tour done and a fresh mount no longer auto-starts', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OnboardingTour />);
    await user.click(screen.getByRole('button', { name: 'Skip tour' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(DONE_KEY)).toBe('1');

    unmount();
    render(<OnboardingTour />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not auto-start when already completed', () => {
    localStorage.setItem(DONE_KEY, '1');
    render(<OnboardingTour />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('replayOnboarding restarts the tour after completion', () => {
    localStorage.setItem(DONE_KEY, '1');
    render(<OnboardingTour />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => {
      replayOnboarding();
    });

    expect(screen.getByRole('dialog')).toHaveTextContent('Welcome to API Circle Studio');
    expect(localStorage.getItem(DONE_KEY)).toBeNull();
  });

  it('Escape exits the tour', async () => {
    const user = userEvent.setup();
    render(<OnboardingTour />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
