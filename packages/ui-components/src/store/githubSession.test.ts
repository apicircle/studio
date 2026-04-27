import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// Tests for the GitHub session store actions. We mock global fetch with
// canned GitHub-shaped responses so the tests run against the real client
// in @apicircle-v2/git without hitting the network.

interface MockResponseSpec {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function mockFetchOnce(spec: MockResponseSpec): ReturnType<typeof vi.fn> {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(spec.body), {
        status: spec.status ?? 200,
        statusText: spec.status === 401 ? 'Unauthorized' : 'OK',
        headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
      }),
  );
}

describe('workspaceStore — GitHub session', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('connectGitHubSession', () => {
    it('verifies the token, encrypts it, and writes session metadata', async () => {
      const fetchMock = mockFetchOnce({
        body: { login: 'devaprakash', id: 7, name: 'Deva' },
        headers: { 'x-oauth-scopes': 'repo, pull_request' },
      });
      vi.stubGlobal('fetch', fetchMock);

      const session = await useWorkspaceStore.getState().connectGitHubSession('ghp_test123');
      expect(session.accountLogin).toBe('devaprakash');
      expect(session.grantedScopes).toEqual(['repo', 'pull_request']);
      expect(session.tokenSecretId).toBeTruthy();

      const local = useWorkspaceStore.getState().local!;
      expect(local.sessions.github?.accountLogin).toBe('devaprakash');
      // Vault entry was created.
      expect(local.secretIndex.entries[session.tokenSecretId]?.label).toBe(
        'github-token:devaprakash',
      );
    });

    it('rejects an empty token without hitting the network', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(useWorkspaceStore.getState().connectGitHubSession('   ')).rejects.toThrow(
        /required/i,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when the token lacks the required `repo` base scope', async () => {
      const fetchMock = mockFetchOnce({
        body: { login: 'u', id: 1 },
        headers: { 'x-oauth-scopes': 'public_repo' },
      });
      vi.stubGlobal('fetch', fetchMock);
      await expect(useWorkspaceStore.getState().connectGitHubSession('tok')).rejects.toThrow(
        /repo/,
      );
      // Session was NOT written.
      expect(useWorkspaceStore.getState().local!.sessions.github).toBeNull();
    });

    it('propagates UnauthorizedError on 401 from GitHub', async () => {
      const fetchMock = mockFetchOnce({
        body: { message: 'Bad credentials' },
        status: 401,
      });
      vi.stubGlobal('fetch', fetchMock);
      await expect(useWorkspaceStore.getState().connectGitHubSession('bad')).rejects.toThrow(
        /credentials/i,
      );
    });
  });

  describe('verifyGitHubScopes', () => {
    it('returns null when no session is active', async () => {
      expect(await useWorkspaceStore.getState().verifyGitHubScopes()).toBeNull();
    });

    it('refreshes grantedScopes + lastVerifiedAt on the active session', async () => {
      // First connect with a 1-scope token.
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo' },
        }),
      );
      await useWorkspaceStore.getState().connectGitHubSession('t1');
      const before = useWorkspaceStore.getState().local!.sessions.github!;

      // Now the user adds pull_request scope on github.com; verify should
      // pick it up.
      vi.unstubAllGlobals();
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo, pull_request' },
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
      const updated = await useWorkspaceStore.getState().verifyGitHubScopes();
      expect(updated).toEqual(['repo', 'pull_request']);
      const after = useWorkspaceStore.getState().local!.sessions.github!;
      expect(after.grantedScopes).toEqual(['repo', 'pull_request']);
      expect(new Date(after.lastVerifiedAt!).getTime()).toBeGreaterThanOrEqual(
        new Date(before.lastVerifiedAt!).getTime(),
      );
    });
  });

  describe('updateGitHubToken', () => {
    it('rotates the ciphertext, refreshes scopes, preserves session metadata', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo' },
        }),
      );
      const original = await useWorkspaceStore.getState().connectGitHubSession('t1');

      vi.unstubAllGlobals();
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo, pull_request' },
        }),
      );
      const updated = await useWorkspaceStore.getState().updateGitHubToken('t2');
      expect(updated.tokenSecretId).toBe(original.tokenSecretId); // same slot
      expect(updated.accountLogin).toBe('me'); // same account
      expect(updated.grantedScopes).toEqual(['repo', 'pull_request']);
    });

    it('rejects a token belonging to a different account', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'first', id: 1 },
          headers: { 'x-oauth-scopes': 'repo' },
        }),
      );
      await useWorkspaceStore.getState().connectGitHubSession('t1');

      vi.unstubAllGlobals();
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'second', id: 2 },
          headers: { 'x-oauth-scopes': 'repo' },
        }),
      );
      await expect(useWorkspaceStore.getState().updateGitHubToken('t2')).rejects.toThrow(
        /Disconnect first/,
      );
    });

    it('throws when there is no active session to update', async () => {
      await expect(useWorkspaceStore.getState().updateGitHubToken('tok')).rejects.toThrow(
        /No active session/,
      );
    });
  });

  describe('disconnectGitHubSession', () => {
    it('clears the session and removes the encrypted token from the vault', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo' },
        }),
      );
      const session = await useWorkspaceStore.getState().connectGitHubSession('t1');

      await useWorkspaceStore.getState().disconnectGitHubSession();
      const local = useWorkspaceStore.getState().local!;
      expect(local.sessions.github).toBeNull();
      expect(local.secretIndex.entries[session.tokenSecretId]).toBeUndefined();
    });

    it('is a safe no-op when no session is active', async () => {
      await expect(useWorkspaceStore.getState().disconnectGitHubSession()).resolves.toBeUndefined();
    });
  });
});
