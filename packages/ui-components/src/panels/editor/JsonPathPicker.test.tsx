import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JsonPathPicker } from './JsonPathPicker';

const FIXTURE = JSON.stringify({
  data: {
    token: 'abc123',
    users: [
      { id: 1, name: 'alice' },
      { id: 2, name: 'bob' },
    ],
  },
  meta: { count: 2 },
});

describe('JsonPathPicker', () => {
  it('shows an empty-state message when given empty JSON text', () => {
    render(<JsonPathPicker jsonText="" onPick={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/No response body/i)).toBeInTheDocument();
  });

  it('shows a parse-error message for non-JSON text', () => {
    render(<JsonPathPicker jsonText="not json{" onPick={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Couldn't parse the response as JSON/i)).toBeInTheDocument();
  });

  it('clicking a leaf calls onPick with the dot-notation path and closes', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<JsonPathPicker jsonText={FIXTURE} onPick={onPick} onClose={onClose} />);
    // Walk: data → token (depth 0+1, so default-expanded). Click 'token'.
    const tokenBtn = screen.getByTitle('Pick data.token');
    await userEvent.click(tokenBtn);
    expect(onPick).toHaveBeenCalledWith('data.token');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking root via the footer button picks $', async () => {
    const onPick = vi.fn();
    render(<JsonPathPicker jsonText={FIXTURE} onPick={onPick} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Pick root/ }));
    expect(onPick).toHaveBeenCalledWith('$');
  });

  it('renders array indices with [n] in the picked path', async () => {
    const onPick = vi.fn();
    render(<JsonPathPicker jsonText={FIXTURE} onPick={onPick} onClose={() => {}} />);
    // 'data' is open by default (depth 0+1), 'users' is open (depth 0+2 boundary).
    // The first user's `name` should be reachable as 'data.users[0].name'.
    // If the deeper level isn't auto-expanded, expand it first.
    const usersToggle = screen.queryByRole('button', { name: /Expand users/i });
    if (usersToggle) await userEvent.click(usersToggle);
    const firstToggle = screen.queryByRole('button', { name: /Expand \[0\]/i });
    if (firstToggle) await userEvent.click(firstToggle);
    const nameBtn = screen.getByTitle('Pick data.users[0].name');
    await userEvent.click(nameBtn);
    expect(onPick).toHaveBeenCalledWith('data.users[0].name');
  });
});
