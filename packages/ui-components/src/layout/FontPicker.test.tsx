import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FontPicker } from './FontPicker';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-font');
  document.documentElement.style.removeProperty('--app-font');
  document.head.querySelectorAll('link[data-apicircle-font]').forEach((el) => el.remove());
});

afterEach(() => {
  localStorage.clear();
});

describe('FontPicker', () => {
  it('opens the dropdown on click', async () => {
    render(<FontPicker />);
    await userEvent.click(screen.getByRole('button', { name: /Choose font family/ }));
    expect(screen.getByRole('listbox', { name: /Font families/ })).toBeInTheDocument();
  });

  it('groups Monospace and Sans-serif sections', async () => {
    render(<FontPicker />);
    await userEvent.click(screen.getByRole('button', { name: /Choose font family/ }));
    expect(screen.getByText('Monospace')).toBeInTheDocument();
    expect(screen.getByText('Sans-serif')).toBeInTheDocument();
  });

  it('persists the choice and updates the trigger label', async () => {
    render(<FontPicker />);
    await userEvent.click(screen.getByRole('button', { name: /Choose font family/ }));
    await userEvent.click(screen.getByRole('option', { name: /JetBrains Mono/ }));
    expect(localStorage.getItem('apicircle-v2:font')).toBe('jetbrains-mono');
    expect(screen.getByRole('button', { name: /Choose font family/ })).toHaveTextContent(
      'JetBrains Mono',
    );
  });

  it('closes the dropdown on Escape', async () => {
    render(<FontPicker />);
    await userEvent.click(screen.getByRole('button', { name: /Choose font family/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: /Font families/ })).not.toBeInTheDocument();
  });

  it('hydrates from localStorage on mount', () => {
    localStorage.setItem('apicircle-v2:font', 'inter');
    render(<FontPicker />);
    expect(screen.getByRole('button', { name: /Choose font family/ })).toHaveTextContent('Inter');
  });
});
