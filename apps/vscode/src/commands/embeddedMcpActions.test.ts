import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { env, window } from '../../test/mocks/vscode';
import {
  startEmbeddedMcpCommand,
  stopEmbeddedMcpCommand,
  restartEmbeddedMcpCommand,
  copyEmbeddedMcpUrlCommand,
  type EmbeddedMcpActionsDeps,
} from './embeddedMcpActions';
import { UnsafeBindHostError } from '../host/embeddedMcpHost';
import type { EmbeddedMcpHost } from '../host/embeddedMcpHost';

const infoStub = {
  url: 'http://127.0.0.1:7474/?token=t',
  bindHost: '127.0.0.1',
  port: 7474,
};

function makeDeps(over: Partial<EmbeddedMcpActionsDeps & { running: boolean }> = {}) {
  const running = over.running ?? false;
  const host = {
    isRunning: vi.fn(() => running),
    info: vi.fn(() => (running ? infoStub : null)),
    start: vi.fn(async () => infoStub),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => infoStub),
  } as unknown as EmbeddedMcpHost;
  const deps: EmbeddedMcpActionsDeps = {
    host,
    getOptions: vi.fn(() => ({ port: 7474, bindHost: '127.0.0.1' })),
    onChanged: vi.fn(),
    log: vi.fn(),
  };
  return { deps, host };
}

function reset(): void {
  (window.showInformationMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (env.clipboard.writeText as Mock).mockReset();
}

describe('startEmbeddedMcpCommand', () => {
  beforeEach(reset);

  it('reports the existing URL without restarting when already running', async () => {
    const { deps, host } = makeDeps({ running: true });
    await startEmbeddedMcpCommand(deps);
    expect((host as unknown as { start: Mock }).start).not.toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining(infoStub.url),
    );
  });

  it('starts, logs, and offers a Copy URL action', async () => {
    const { deps, host } = makeDeps();
    (window.showInformationMessage as Mock).mockResolvedValueOnce('Copy URL');
    await startEmbeddedMcpCommand(deps);
    expect((host as unknown as { start: Mock }).start).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('started'));
    expect(deps.onChanged).toHaveBeenCalledTimes(1);
    expect(env.clipboard.writeText).toHaveBeenCalledWith(infoStub.url);
  });

  it('skips clipboard write when user dismisses the Copy URL prompt', async () => {
    const { deps } = makeDeps();
    (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
    await startEmbeddedMcpCommand(deps);
    expect(env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('shows a modal error on UnsafeBindHostError', async () => {
    const { deps, host } = makeDeps();
    (host as unknown as { start: Mock }).start.mockRejectedValueOnce(
      new UnsafeBindHostError('0.0.0.0 is unsafe'),
    );
    await startEmbeddedMcpCommand(deps);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('0.0.0.0 is unsafe'),
      { modal: true },
    );
  });

  it('shows a non-modal error on generic start failure', async () => {
    const { deps, host } = makeDeps();
    (host as unknown as { start: Mock }).start.mockRejectedValueOnce(new Error('EADDRINUSE'));
    await startEmbeddedMcpCommand(deps);
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('EADDRINUSE'));
  });
});

describe('stopEmbeddedMcpCommand', () => {
  beforeEach(reset);

  it('is a no-op when not running', async () => {
    const { deps, host } = makeDeps({ running: false });
    await stopEmbeddedMcpCommand(deps);
    expect((host as unknown as { stop: Mock }).stop).not.toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenCalledWith('Embedded MCP host is not running.');
  });

  it('stops, logs, and notifies when running', async () => {
    const { deps, host } = makeDeps({ running: true });
    await stopEmbeddedMcpCommand(deps);
    expect((host as unknown as { stop: Mock }).stop).toHaveBeenCalledTimes(1);
    expect(deps.onChanged).toHaveBeenCalledTimes(1);
    expect(window.showInformationMessage).toHaveBeenCalledWith('Embedded MCP host stopped.');
  });
});

describe('restartEmbeddedMcpCommand', () => {
  beforeEach(reset);

  it('rotates the token, logs, and shows a restart info message', async () => {
    const { deps, host } = makeDeps({ running: true });
    await restartEmbeddedMcpCommand(deps);
    expect((host as unknown as { restart: Mock }).restart).toHaveBeenCalledWith({
      port: 7474,
      bindHost: '127.0.0.1',
    });
    expect(window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('rotated'));
  });

  it('shows a modal error on UnsafeBindHostError', async () => {
    const { deps, host } = makeDeps();
    (host as unknown as { restart: Mock }).restart.mockRejectedValueOnce(
      new UnsafeBindHostError('bad bind'),
    );
    await restartEmbeddedMcpCommand(deps);
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.any(String), { modal: true });
  });

  it('shows a non-modal error on generic failure', async () => {
    const { deps, host } = makeDeps();
    (host as unknown as { restart: Mock }).restart.mockRejectedValueOnce(new Error('boom'));
    await restartEmbeddedMcpCommand(deps);
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('copyEmbeddedMcpUrlCommand', () => {
  beforeEach(reset);

  it('warns when host is not running', async () => {
    const { deps } = makeDeps({ running: false });
    await copyEmbeddedMcpUrlCommand(deps);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('is not running'),
    );
    expect(env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('writes the running URL to the clipboard', async () => {
    const { deps } = makeDeps({ running: true });
    await copyEmbeddedMcpUrlCommand(deps);
    expect(env.clipboard.writeText).toHaveBeenCalledWith(infoStub.url);
    expect(window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Copied'));
  });
});
