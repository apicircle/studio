import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { tryRegisterEmbeddedMcpAsLmProvider } from './proposedMcpProviderRegistration';
import type { EmbeddedMcpHost } from './embeddedMcpHost';

function makeFakeHost(info: { url: string; token: string } | null): EmbeddedMcpHost {
  return {
    info: () => (info ? { ...info, port: 1, bindHost: '127.0.0.1' } : null),
  } as unknown as EmbeddedMcpHost;
}

describe('tryRegisterEmbeddedMcpAsLmProvider', () => {
  beforeEach(() => {
    // Reset any state we mutated on vscode.
    delete (vscode as unknown as { lm?: unknown }).lm;
  });

  afterEach(() => {
    delete (vscode as unknown as { lm?: unknown }).lm;
  });

  it('returns null when vscode.lm is undefined (engine has no proposed API)', () => {
    const reg = tryRegisterEmbeddedMcpAsLmProvider(
      makeFakeHost({ url: 'http://127.0.0.1:1/mcp?token=x', token: 'x' }),
    );
    expect(reg).toBeNull();
  });

  it('returns null when registerMcpServerDefinitionProvider is missing on vscode.lm', () => {
    (vscode as unknown as { lm: object }).lm = {};
    const reg = tryRegisterEmbeddedMcpAsLmProvider(
      makeFakeHost({ url: 'http://127.0.0.1:1/mcp?token=x', token: 'x' }),
    );
    expect(reg).toBeNull();
  });

  it('registers + returns a refreshable disposable when the API is present', () => {
    const registerFn = vi.fn(() => ({ dispose: vi.fn() }));
    (vscode as unknown as { lm: object }).lm = {
      registerMcpServerDefinitionProvider: registerFn,
    };
    const host = makeFakeHost({ url: 'http://127.0.0.1:7/mcp?token=tok', token: 'tok' });
    const reg = tryRegisterEmbeddedMcpAsLmProvider(host);
    expect(reg).not.toBeNull();
    expect(registerFn).toHaveBeenCalledTimes(1);
    expect(registerFn).toHaveBeenCalledWith(
      'apicircle-embedded',
      expect.objectContaining({
        provideMcpServerDefinitions: expect.any(Function),
      }),
    );
    reg!.refresh();
    reg!.dispose();
  });

  it('provideMcpServerDefinitions returns empty list when host is not running', () => {
    let captured: { provideMcpServerDefinitions: () => unknown[] } | null = null;
    (vscode as unknown as { lm: object }).lm = {
      registerMcpServerDefinitionProvider: (_id: string, provider: typeof captured) => {
        captured = provider;
        return { dispose: vi.fn() };
      },
    };
    tryRegisterEmbeddedMcpAsLmProvider(makeFakeHost(null));
    expect(captured).not.toBeNull();
    expect(captured!.provideMcpServerDefinitions()).toEqual([]);
  });

  it('provideMcpServerDefinitions returns one definition with the embedded URL + Bearer header', () => {
    let captured: { provideMcpServerDefinitions: () => unknown[] } | null = null;
    (vscode as unknown as { lm: object }).lm = {
      registerMcpServerDefinitionProvider: (_id: string, provider: typeof captured) => {
        captured = provider;
        return { dispose: vi.fn() };
      },
    };
    const host = makeFakeHost({
      url: 'http://127.0.0.1:9/mcp?token=secret',
      token: 'secret',
    });
    tryRegisterEmbeddedMcpAsLmProvider(host);
    const defs = captured!.provideMcpServerDefinitions() as Array<{
      label: string;
      url: string;
      headers: Record<string, string>;
    }>;
    expect(defs).toHaveLength(1);
    expect(defs[0].label).toBe('API Circle (embedded)');
    expect(defs[0].url).toBe('http://127.0.0.1:9/mcp?token=secret');
    expect(defs[0].headers.Authorization).toBe('Bearer secret');
  });
});
