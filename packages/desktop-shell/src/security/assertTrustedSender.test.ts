import { describe, expect, it } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { assertTrustedSender } from './assertTrustedSender';

// Construct just enough of an IpcMainInvokeEvent to exercise the prefix check.
// Real Electron events carry far more state (sender, ports, returnValue, etc),
// but the helper only reads `event.senderFrame?.url`.
function fakeEvent(url: string | undefined): IpcMainInvokeEvent {
  return {
    senderFrame: url === undefined ? null : ({ url } as IpcMainInvokeEvent['senderFrame']),
  } as IpcMainInvokeEvent;
}

describe('assertTrustedSender', () => {
  it('accepts events whose senderFrame URL is file://', () => {
    expect(() => assertTrustedSender(fakeEvent('file:///dist/index.html'))).not.toThrow();
  });

  it('accepts file:// URLs with query/fragment for client-side routing', () => {
    expect(() =>
      assertTrustedSender(fakeEvent('file:///dist/index.html?panel=editor#req-1')),
    ).not.toThrow();
  });

  it('rejects events from https origins (window.open escape)', () => {
    expect(() => assertTrustedSender(fakeEvent('https://attacker.example/'))).toThrow(
      /Untrusted IPC sender/,
    );
  });

  it('rejects events from http://localhost (web-mode renderer should not invoke main IPC)', () => {
    expect(() => assertTrustedSender(fakeEvent('http://localhost:5173/'))).toThrow(
      /Untrusted IPC sender/,
    );
  });

  it('rejects events with no senderFrame (detached frame, programmatic emit)', () => {
    expect(() => assertTrustedSender(fakeEvent(undefined))).toThrow(/Untrusted IPC sender/);
  });

  it('rejects events whose URL only resembles file:// (prefix-tampering)', () => {
    expect(() => assertTrustedSender(fakeEvent('file:not-a-url'))).toThrow(/Untrusted IPC sender/);
    expect(() => assertTrustedSender(fakeEvent('https://example.com/?u=file://'))).toThrow(
      /Untrusted IPC sender/,
    );
  });
});
