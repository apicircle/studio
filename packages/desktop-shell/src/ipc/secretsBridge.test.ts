import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
      __handlers__: handlers,
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
      decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')),
    },
  };
});

import { ipcMain as ipcMainMock, safeStorage } from 'electron';
import { MAX_SECRET_PAYLOAD_BYTES, registerSecretsBridge, SECRET_CHANNELS } from './secretsBridge';

const handlers = (
  ipcMainMock as unknown as { __handlers__: Map<string, (...a: unknown[]) => unknown> }
).__handlers__;
const trusted = { senderFrame: { url: 'file:///dist/index.html' } };

function call(channel: string, ...args: unknown[]) {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn(trusted, ...args);
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  registerSecretsBridge();
});

describe('secretsBridge', () => {
  it('rejects an untrusted sender', () => {
    const fn = handlers.get(SECRET_CHANNELS.isAvailable)!;
    expect(() => fn({ senderFrame: { url: 'https://evil.test' } })).toThrow(/Untrusted IPC sender/);
  });

  it('reports keychain availability', () => {
    expect(call(SECRET_CHANNELS.isAvailable)).toBe(true);
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    expect(call(SECRET_CHANNELS.isAvailable)).toBe(false);
  });

  it('round-trips encrypt → decrypt', () => {
    const ciphertext = call(SECRET_CHANNELS.encrypt, 'my-secret') as string;
    expect(typeof ciphertext).toBe('string');
    expect(call(SECRET_CHANNELS.decrypt, ciphertext)).toBe('my-secret');
  });

  it('encrypt validates type, size, and availability', () => {
    expect(() => call(SECRET_CHANNELS.encrypt, 123)).toThrow(/must be a string/);
    expect(() => call(SECRET_CHANNELS.encrypt, 'x'.repeat(MAX_SECRET_PAYLOAD_BYTES + 1))).toThrow(
      /exceeds MAX_SECRET_PAYLOAD_BYTES/,
    );
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    expect(() => call(SECRET_CHANNELS.encrypt, 'x')).toThrow(/keychain not available/);
  });

  it('decrypt validates type, size, and availability', () => {
    expect(() => call(SECRET_CHANNELS.decrypt, 123)).toThrow(/base64 string/);
    expect(() =>
      call(SECRET_CHANNELS.decrypt, 'x'.repeat(MAX_SECRET_PAYLOAD_BYTES * 2 + 1)),
    ).toThrow(/exceeds MAX_SECRET_PAYLOAD_BYTES/);
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    expect(() => call(SECRET_CHANNELS.decrypt, 'eA==')).toThrow(/keychain not available/);
  });
});
