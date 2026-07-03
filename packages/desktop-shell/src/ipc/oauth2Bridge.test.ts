import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
      __handlers__: handlers,
    },
  };
});

vi.mock('../oauth2Server', () => ({
  findFreePort: vi.fn(async (p: number) => p),
  openInBrowser: vi.fn(async () => undefined),
  startCallbackServer: vi.fn(async () => ({ port: 4567, redirectUri: 'http://localhost:4567/cb' })),
}));

import { ipcMain as ipcMainMock } from 'electron';
import { findFreePort, openInBrowser, startCallbackServer } from '../oauth2Server';
import { OAUTH2_CHANNELS, registerOAuth2Bridge } from './oauth2Bridge';

const handlers = (
  ipcMainMock as unknown as { __handlers__: Map<string, (...a: unknown[]) => unknown> }
).__handlers__;
const trusted = { senderFrame: { url: 'file:///dist/index.html' } };
const goodArgs = { authorizeUrl: 'https://idp.test/authorize', port: 4567, mode: 'code' as const };

function call(channel: string, ...args: unknown[]) {
  return handlers.get(channel)!(trusted, ...args);
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  registerOAuth2Bridge();
});

describe('oauth2Bridge.findFreePort', () => {
  it('rejects an untrusted sender', async () => {
    const fn = handlers.get(OAUTH2_CHANNELS.findFreePort)!;
    await expect(fn({ senderFrame: { url: 'https://evil.test' } }, 5000)).rejects.toThrow(
      /Untrusted IPC sender/,
    );
  });

  it('validates the preferred port and delegates when valid', async () => {
    await expect(call(OAUTH2_CHANNELS.findFreePort, 'x')).rejects.toThrow(/must be an integer/);
    await expect(call(OAUTH2_CHANNELS.findFreePort, 3.5)).rejects.toThrow(/must be an integer/);
    await expect(call(OAUTH2_CHANNELS.findFreePort, 100)).rejects.toThrow(/1024\.\.65535/);
    await expect(call(OAUTH2_CHANNELS.findFreePort, 70000)).rejects.toThrow(/1024\.\.65535/);
    await expect(call(OAUTH2_CHANNELS.findFreePort, 5000)).resolves.toBe(5000);
    expect(findFreePort).toHaveBeenCalledWith(5000);
  });
});

describe('oauth2Bridge.startFlow', () => {
  it('runs the flow and returns the callback result', async () => {
    await expect(call(OAUTH2_CHANNELS.startFlow, goodArgs)).resolves.toMatchObject({ port: 4567 });
    expect(startCallbackServer).toHaveBeenCalledOnce();
    expect(openInBrowser).toHaveBeenCalledWith('https://idp.test/authorize');
  });

  it('accepts a valid timeout and callbackPath', async () => {
    await expect(
      call(OAUTH2_CHANNELS.startFlow, { ...goodArgs, timeoutMs: 6000, callbackPath: '/cb' }),
    ).resolves.toMatchObject({ port: 4567 });
  });

  it('rejects a sub-5s timeout', async () => {
    await expect(call(OAUTH2_CHANNELS.startFlow, { ...goodArgs, timeoutMs: 1000 })).rejects.toThrow(
      /at least 5000ms/,
    );
  });

  it('rejects a non-http authorize URL', async () => {
    await expect(
      call(OAUTH2_CHANNELS.startFlow, { ...goodArgs, authorizeUrl: 'file:///etc/passwd' }),
    ).rejects.toThrow(/must use https: or http:/);
  });

  it('rejects a malformed callbackPath', async () => {
    await expect(
      call(OAUTH2_CHANNELS.startFlow, { ...goodArgs, callbackPath: 'no-leading-slash!' }),
    ).rejects.toThrow(/callbackPath must match/);
  });

  it('rejects a non-string callbackPath', async () => {
    await expect(
      call(OAUTH2_CHANNELS.startFlow, { ...goodArgs, callbackPath: 123 as unknown as string }),
    ).rejects.toThrow(/callbackPath must match/);
  });

  it('still resolves when the browser fails to open (user can paste the URL)', async () => {
    vi.mocked(openInBrowser).mockRejectedValueOnce(new Error('no browser'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(call(OAUTH2_CHANNELS.startFlow, goodArgs)).resolves.toMatchObject({ port: 4567 });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
