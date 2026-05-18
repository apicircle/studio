import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FullscreenOverlay } from './FullscreenOverlay';

describe('FullscreenOverlay', () => {
  it('does not render anything when closed', () => {
    render(
      <FullscreenOverlay open={false} onClose={() => undefined} title="X">
        <p>body</p>
      </FullscreenOverlay>,
    );
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('renders the title and children when open', () => {
    render(
      <FullscreenOverlay open onClose={() => undefined} title="Request body">
        <p>my content</p>
      </FullscreenOverlay>,
    );
    expect(screen.getByRole('dialog', { name: 'Request body' })).toBeInTheDocument();
    expect(screen.getByText('my content')).toBeInTheDocument();
  });

  it('invokes onClose when the Exit fullscreen button is pressed', async () => {
    const onClose = vi.fn();
    render(
      <FullscreenOverlay open onClose={onClose} title="X">
        <p>body</p>
      </FullscreenOverlay>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('invokes onClose on Escape', async () => {
    const onClose = vi.fn();
    render(
      <FullscreenOverlay open onClose={onClose} title="X">
        <p>body</p>
      </FullscreenOverlay>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
