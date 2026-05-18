import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAsyncOp } from './useAsyncOp';
import { ToastViewport } from './Toast';

// Minimal harness — mounts the viewport bound to the live store slice.
function Harness() {
  const toasts = useWorkspaceStore((s) => s.toasts);
  const dismiss = useWorkspaceStore((s) => s.dismissToast);
  return <ToastViewport toasts={toasts} onDismiss={dismiss} />;
}

describe('Toast viewport + store slice', () => {
  beforeEach(() => {
    // Start each test with no toasts pending.
    useWorkspaceStore.setState({ toasts: [] });
  });
  afterEach(() => {
    useWorkspaceStore.setState({ toasts: [] });
  });

  it('renders nothing when no toasts are queued', () => {
    render(<Harness />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pushes a toast and renders it with role=status for info/success', () => {
    render(<Harness />);
    act(() => {
      useWorkspaceStore.getState().pushToast({ tone: 'success', title: 'Saved' });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('pushes an error toast and renders it with role=alert', () => {
    render(<Harness />);
    act(() => {
      useWorkspaceStore.getState().pushToast({
        tone: 'error',
        title: 'Boom',
        detail: 'something exploded',
      });
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Boom');
    expect(alert).toHaveTextContent('something exploded');
  });

  it('dismisses a toast when the close button is clicked', async () => {
    render(<Harness />);
    act(() => {
      useWorkspaceStore.getState().pushToast({ tone: 'info', title: 'Hello' });
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('auto-dismisses on TTL via dismissToast', async () => {
    // No fake timers here — drive dismissToast directly to keep the test
    // deterministic and avoid fake-timer/userEvent interactions.
    render(<Harness />);
    let pushedId = '';
    act(() => {
      pushedId = useWorkspaceStore.getState().pushToast({
        tone: 'info',
        title: 'Quick',
        ttlMs: 10,
      });
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull(), { timeout: 1000 });
    // The toast slice should also have removed it from the array.
    expect(useWorkspaceStore.getState().toasts.find((t) => t.id === pushedId)).toBeUndefined();
  });
});

describe('useAsyncOp', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ toasts: [] });
  });
  afterEach(() => {
    useWorkspaceStore.setState({ toasts: [] });
  });

  it('returns the resolved value on success and does not toast', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const { result } = renderHook(() => useAsyncOp(fn));
    let resolved: number | null = null;
    await act(async () => {
      resolved = await result.current.run();
    });
    expect(resolved).toBe(42);
    expect(useWorkspaceStore.getState().toasts).toHaveLength(0);
    expect(result.current.status).toBe('success');
  });

  it('surfaces failures via toast and returns null', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useAsyncOp<[], number>(fn, { errorTitle: 'Save failed' }));
    let resolved: number | null = -1;
    await act(async () => {
      resolved = await result.current.run();
    });
    expect(resolved).toBeNull();
    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('nope');
    const toasts = useWorkspaceStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ tone: 'error', title: 'Save failed', detail: 'nope' });
  });

  it('suppresses error toast when toastOnError=false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('quiet'));
    const { result } = renderHook(() => useAsyncOp<[], number>(fn, { toastOnError: false }));
    await act(async () => {
      await result.current.run();
    });
    expect(useWorkspaceStore.getState().toasts).toHaveLength(0);
    expect(result.current.error?.message).toBe('quiet');
  });

  it('emits a success toast when successTitle is provided', async () => {
    const fn = vi.fn().mockResolvedValue('done');
    const { result } = renderHook(() => useAsyncOp(fn, { successTitle: 'Saved' }));
    await act(async () => {
      await result.current.run();
    });
    const toasts = useWorkspaceStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ tone: 'success', title: 'Saved' });
  });
});
