import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseConfirmModal } from './CloseConfirmModal';

type Listener<T> = (p: T) => void;

let prompt: Listener<{ runningMocks: { serverId: string; port: number }[] }>;
let progress: Listener<{ completed: number; total: number }>;
let complete: () => void;
let lifecycle: {
  onPromptClose: ReturnType<typeof vi.fn>;
  onShutdownProgress: ReturnType<typeof vi.fn>;
  onShutdownComplete: ReturnType<typeof vi.fn>;
  cancelClose: ReturnType<typeof vi.fn>;
  confirmClose: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  lifecycle = {
    onPromptClose: vi.fn((cb) => {
      prompt = cb;
      return () => {};
    }),
    onShutdownProgress: vi.fn((cb) => {
      progress = cb;
      return () => {};
    }),
    onShutdownComplete: vi.fn((cb) => {
      complete = cb;
      return () => {};
    }),
    cancelClose: vi.fn().mockResolvedValue(undefined),
    confirmClose: vi.fn().mockResolvedValue(undefined),
  };
  (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop = { lifecycle };
});

afterEach(() => {
  delete (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop;
});

function askToClose(mocks = [{ serverId: 'petstore', port: 4040 }]) {
  render(<CloseConfirmModal />);
  act(() => prompt({ runningMocks: mocks }));
}

describe('CloseConfirmModal', () => {
  it('asks before closing over running mock servers, and Cancel keeps the app open', async () => {
    askToClose();
    expect(screen.getByRole('dialog', { name: 'Mock servers are running' })).toHaveTextContent(
      '1 mock server is still running',
    );
    expect(screen.getByText('port 4040')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(lifecycle.cancelClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('counts the servers down on a ring as they stop', async () => {
    askToClose([
      { serverId: 'a', port: 4040 },
      { serverId: 'b', port: 4041 },
    ]);
    await userEvent.click(screen.getByRole('button', { name: /Stop & close/ }));
    expect(lifecycle.confirmClose).toHaveBeenCalledOnce();
    act(() => progress({ completed: 1, total: 2 }));
    const ring = screen.getByRole('progressbar', { name: 'Stopping mock servers' });
    expect(ring).toHaveAttribute('aria-valuenow', '0.5');
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('Releasing port for 1 of 2 servers.')).toBeInTheDocument();
    expect(ring.querySelector('svg[data-brand-loader]')).toBeNull();
  });

  it('waits on the brand mark, not a spun ring, when there is nothing left to count', async () => {
    askToClose();
    await userEvent.click(screen.getByRole('button', { name: /Stop & close/ }));
    act(() => progress({ completed: 0, total: 0 }));
    const wait = screen.getByRole('progressbar', { name: 'Stopping mock servers' });
    // Indeterminate: no value to report.
    expect(wait).not.toHaveAttribute('aria-valuenow');
    expect(wait.querySelector('svg[data-brand-loader="full"]')).toHaveAttribute('width', '64');
    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(screen.getByText('Mock servers stopped')).toBeInTheDocument();
    act(() => complete());
    expect(screen.getByRole('dialog', { name: 'Closing API Circle' })).toBeInTheDocument();
  });
});
