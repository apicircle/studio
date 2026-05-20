import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateAvailableBanner } from './UpdateAvailableBanner';

interface UpdateBridge {
  onAvailable: (
    cb: (payload: {
      version: string;
      releaseNotesUrl: string | null;
      releaseDate: string | null;
    }) => void,
  ) => () => void;
  applyUpdate: () => Promise<void>;
  checkNow: () => Promise<{ checked: boolean; reason?: string }>;
}

function installBridge(bridge: UpdateBridge | null) {
  // The component reads `globalThis.apicircleDesktop?.update`.
  const win = globalThis as unknown as {
    apicircleDesktop?: { update?: UpdateBridge };
  };
  if (bridge === null) {
    delete win.apicircleDesktop;
  } else {
    win.apicircleDesktop = { update: bridge };
  }
}

describe('UpdateAvailableBanner', () => {
  beforeEach(() => {
    installBridge(null);
  });

  afterEach(() => {
    installBridge(null);
  });

  it('renders nothing on web (no bridge present)', () => {
    const { container } = render(<UpdateAvailableBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing until the bridge emits an update-available event', () => {
    installBridge({
      onAvailable: () => () => undefined,
      applyUpdate: () => Promise.resolve(),
      checkNow: () => Promise.resolve({ checked: false }),
    });
    const { container } = render(<UpdateAvailableBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows version + release-notes link when an update is available', () => {
    let emit:
      | ((p: {
          version: string;
          releaseNotesUrl: string | null;
          releaseDate: string | null;
        }) => void)
      | null = null;
    installBridge({
      onAvailable: (cb) => {
        emit = cb;
        return () => undefined;
      },
      applyUpdate: () => Promise.resolve(),
      checkNow: () => Promise.resolve({ checked: false }),
    });
    render(<UpdateAvailableBanner />);
    act(() => {
      emit!({
        version: '0.1.1',
        releaseNotesUrl: 'https://github.com/apicircle/studio/releases/tag/v0.1.1',
        releaseDate: '2026-05-13T00:00:00Z',
      });
    });
    expect(screen.getByText(/v0\.1\.1/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Release notes/ });
    expect(link).toHaveAttribute('href', 'https://github.com/apicircle/studio/releases/tag/v0.1.1');
  });

  it('Restart to install calls bridge.applyUpdate', async () => {
    const applyUpdate = vi.fn().mockResolvedValue(undefined);
    let emit:
      | ((p: {
          version: string;
          releaseNotesUrl: string | null;
          releaseDate: string | null;
        }) => void)
      | null = null;
    installBridge({
      onAvailable: (cb) => {
        emit = cb;
        return () => undefined;
      },
      applyUpdate,
      checkNow: () => Promise.resolve({ checked: false }),
    });
    render(<UpdateAvailableBanner />);
    act(() => {
      emit!({ version: '0.1.1', releaseNotesUrl: null, releaseDate: null });
    });
    fireEvent.click(screen.getByRole('button', { name: /Restart to install/ }));
    await Promise.resolve();
    expect(applyUpdate).toHaveBeenCalledOnce();
  });

  it('Dismiss hides the banner; a subsequent emit re-opens it', () => {
    let emit:
      | ((p: {
          version: string;
          releaseNotesUrl: string | null;
          releaseDate: string | null;
        }) => void)
      | null = null;
    installBridge({
      onAvailable: (cb) => {
        emit = cb;
        return () => undefined;
      },
      applyUpdate: () => Promise.resolve(),
      checkNow: () => Promise.resolve({ checked: false }),
    });
    render(<UpdateAvailableBanner />);
    act(() => emit!({ version: '0.1.1', releaseNotesUrl: null, releaseDate: null }));
    expect(screen.getByText(/v0\.1\.1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss update notice/ }));
    expect(screen.queryByText(/v0\.1\.1/)).toBeNull();
    // A new emit (e.g. a later release) should re-show.
    act(() => emit!({ version: '0.1.2', releaseNotesUrl: null, releaseDate: null }));
    expect(screen.getByText(/v0\.1\.2/)).toBeInTheDocument();
  });
});
