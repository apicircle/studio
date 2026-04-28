import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockRuntimeEntry, MockServer } from '@apicircle/shared';
import { MockServersPanel } from './MockServersPanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

const T0 = '2026-04-27T00:00:00.000Z';

function fixtureMock(id: string, name: string): MockServer {
  return {
    id,
    name,
    source: { kind: 'manual', endpoints: [] },
    endpoints: [
      {
        id: 'ep1',
        method: 'GET',
        pathPattern: '/health',
        status: 200,
        headers: [],
        body: '{}',
      },
    ],
    overrides: {},
    defaultPort: null,
    cors: { enabled: false, origins: [] },
    createdAt: T0,
    updatedAt: T0,
  };
}

let bridge: {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  getRuntime: ReturnType<typeof vi.fn>;
  stopAll: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  bridge = {
    start: vi.fn().mockResolvedValue({
      port: 4040,
      pid: 1234,
      startedAt: T0,
      lastError: null,
      requestCount: 0,
    } satisfies MockRuntimeEntry),
    stop: vi.fn().mockResolvedValue({ ok: true }),
    list: vi.fn().mockResolvedValue([]),
    getRuntime: vi.fn().mockResolvedValue(null),
    stopAll: vi.fn().mockResolvedValue({ ok: true }),
  };
  (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop = { mock: bridge };
});

afterEach(() => {
  delete (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop;
  vi.useRealTimers();
});

describe('MockServersPanel', () => {
  it('shows the empty state when no mocks exist', async () => {
    await renderWithStore(<MockServersPanel />);
    expect(screen.getByText('No mock servers yet.')).toBeInTheDocument();
  });

  it('renders mocks from the synced doc', async () => {
    await renderWithStore(<MockServersPanel />);
    useWorkspaceStore.setState((s) => ({
      ...s,
      synced: {
        ...(s.synced ?? ({} as never)),
        mockServers: { m1: fixtureMock('m1', 'Petstore') },
      },
    }));
    expect(await screen.findByText('Petstore')).toBeInTheDocument();
  });

  it('shows the desktop banner when the bridge is missing', async () => {
    delete (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop;
    await renderWithStore(<MockServersPanel />);
    expect(screen.getByText(/Desktop App/i)).toBeInTheDocument();
  });

  it('Start button calls into the bridge when present', async () => {
    await renderWithStore(<MockServersPanel />);
    useWorkspaceStore.setState((s) => ({
      ...s,
      synced: {
        ...(s.synced ?? ({} as never)),
        mockServers: { m1: fixtureMock('m1', 'Petstore') },
      },
    }));
    const startBtn = await screen.findByRole('button', { name: /Start/ });
    await userEvent.click(startBtn);
    expect(bridge.start).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  it('surfaces start errors to the user', async () => {
    bridge.start.mockRejectedValueOnce(new Error('port busy'));
    await renderWithStore(<MockServersPanel />);
    useWorkspaceStore.setState((s) => ({
      ...s,
      synced: {
        ...(s.synced ?? ({} as never)),
        mockServers: { m1: fixtureMock('m1', 'Petstore') },
      },
    }));
    const startBtn = await screen.findByRole('button', { name: /Start/ });
    await userEvent.click(startBtn);
    expect(await screen.findByText('port busy')).toBeInTheDocument();
  });
});
