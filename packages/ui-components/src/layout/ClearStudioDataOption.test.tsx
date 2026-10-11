import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClearStudioDataOption } from './ClearStudioDataOption';

describe('ClearStudioDataOption', () => {
  it('says what goes, what brings it back, and what is kept', () => {
    render(<ClearStudioDataOption checked={false} onChange={() => {}} />);
    const option = screen.getByRole('checkbox', {
      name: /Also clear this workspace's Studio data/,
    });
    expect(option).not.toBeChecked();
    const said = option.closest('label')!.textContent;
    expect(said).toContain(
      'Its requests, folders, environments, mock servers, plans and global assets all go.',
    );
    expect(said).toContain(
      'A Before clearing snapshot is captured first, so History → Snapshots can put them back.',
    );
    expect(said).toContain(
      'Run history and saved secrets are kept, and whatever was pushed stays in the repository.',
    );
  });

  it('reports each press, and shows the state it is given', async () => {
    const onChange = vi.fn();
    const view = render(<ClearStudioDataOption checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenLastCalledWith(true);

    view.rerender(<ClearStudioDataOption checked onChange={onChange} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
