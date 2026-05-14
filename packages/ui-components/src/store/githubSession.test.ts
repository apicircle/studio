import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// Tests for the GitHub session store actions. We mock global fetch with
// canned GitHub-shaped responses so the tests run against the real client
// in @apicircle/git without hitting the network.

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
      expect(local.sessions.github.workspace?.accountLogin).toBe('devaprakash');
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
      expect(useWorkspaceStore.getState().local!.sessions.github.workspace).toBeNull();
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
      const before = useWorkspaceStore.getState().local!.sessions.github.workspace!;

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
      const after = useWorkspaceStore.getState().local!.sessions.github.workspace!;
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
      expect(local.sessions.github.workspace).toBeNull();
      expect(local.secretIndex.entries[session.tokenSecretId]).toBeUndefined();
    });

    it('is a safe no-op when no session is active', async () => {
      await expect(useWorkspaceStore.getState().disconnectGitHubSession()).resolves.toBeUndefined();
    });
  });

  describe('connectGitHubSessionViaDeviceFlow (B.5)', () => {
    it('uses the bundled default client id when no env override is set', async () => {
      // import.meta.env.VITE_GITHUB_OAUTH_CLIENT_ID is undefined by
      // default in the test bundle — the bundled default must drive the
      // device-flow start call so unforked builds work out of the box.
      const fetchSpy = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'authorization_pending' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      // First call is startDeviceFlow — we abort before any poll, so
      // we only need a single placeholder response above. Wire a real
      // device_code response for the first call:
      fetchSpy.mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              device_code: 'dc-default',
              user_code: 'AAAA-AAAA',
              verification_uri: 'https://github.com/login/device',
              expires_in: 1,
              interval: 0,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      );

      const controller = new AbortController();
      let codeReady: { userCode: string } | null = null;
      const promise = useWorkspaceStore.getState().connectGitHubSessionViaDeviceFlow({
        onCodeReady: (info) => {
          codeReady = info;
          controller.abort();
        },
        signal: controller.signal,
      });
      await expect(promise).rejects.toThrow(/cancelled|expired/);
      expect(codeReady).not.toBeNull();

      const firstCallBody = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body)) as {
        client_id: string;
      };
      expect(firstCallBody.client_id).toBe('Ov23lidibDgD8hoGFB67');

      vi.unstubAllGlobals();
    });

    it('orchestrates device-code → poll-pending → granted → session vaulted', async () => {
      // vi.stubEnv mutates the SAME import.meta.env object the SUT reads.
      vi.stubEnv('VITE_GITHUB_OAUTH_CLIENT_ID', 'test-client-id');

      // Track calls: 1) startDeviceFlow, 2) pending poll, 3) granted poll,
      // 4) getViewer (called from connectGitHubSession after grant).
      const responses = [
        // startDeviceFlow → user_code + device_code
        {
          body: {
            device_code: 'dc-abc',
            user_code: 'WDJB-MJHT',
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            interval: 0, // no real wait so the test runs quickly
          },
        },
        // First poll → pending
        { body: { error: 'authorization_pending' } },
        // Second poll → granted
        {
          body: {
            access_token: 'gho_real',
            token_type: 'bearer',
            scope: 'repo,pull_request',
          },
        },
        // getViewer call from connectGitHubSession with the granted token
        {
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo, pull_request' },
        },
      ];
      let callIdx = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          const spec = responses[callIdx++];
          return new Response(JSON.stringify(spec.body), {
            status: 200,
            headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
          });
        }),
      );

      let codeReady: { userCode: string; verificationUri: string } | null = null;
      const session = await useWorkspaceStore.getState().connectGitHubSessionViaDeviceFlow({
        onCodeReady: (info) => {
          codeReady = info;
        },
      });

      // The user-facing code surfaced via the onCodeReady callback.
      expect(codeReady).not.toBeNull();
      expect(codeReady!.userCode).toBe('WDJB-MJHT');
      expect(codeReady!.verificationUri).toBe('https://github.com/login/device');

      // The session was vaulted via the standard PAT flow (encrypted +
      // surfaced on local.sessions.github).
      expect(session.accountLogin).toBe('me');
      expect(session.grantedScopes).toContain('repo');
      expect(useWorkspaceStore.getState().local?.sessions.github.workspace?.accountLogin).toBe(
        'me',
      );

      vi.unstubAllEnvs();
    });

    it('surfaces a clear error when GitHub returns access_denied', async () => {
      const meta = import.meta as unknown as { env: Record<string, string | undefined> };
      const originalEnv = meta.env.VITE_GITHUB_OAUTH_CLIENT_ID;
      meta.env.VITE_GITHUB_OAUTH_CLIENT_ID = 'test-client-id';

      try {
        const responses = [
          {
            body: {
              device_code: 'dc-abc',
              user_code: 'WDJB-MJHT',
              verification_uri: 'https://github.com/login/device',
              expires_in: 900,
              interval: 0,
            },
          },
          { body: { error: 'access_denied', error_description: 'User refused' } },
        ];
        let callIdx = 0;
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => {
            const spec = responses[callIdx++];
            return new Response(JSON.stringify(spec.body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }),
        );

        await expect(
          useWorkspaceStore.getState().connectGitHubSessionViaDeviceFlow({ onCodeReady: () => {} }),
        ).rejects.toThrow(/denied/);
      } finally {
        meta.env.VITE_GITHUB_OAUTH_CLIENT_ID = originalEnv;
        vi.unstubAllEnvs();
      }
    });
  });

  // PR-creation capability is computed at session connect from the granted
  // scopes, then re-evaluated (with a network probe fallback) on
  // connectRepo / verifyGitHubScopes / updateGitHubToken. The flag drives
  // both the SessionCard warning and the Create PR button enable state, so
  // the wiring needs end-to-end coverage.
  describe('canCreatePullRequests capability', () => {
    /**
     * Helper: build a fetch stub that walks `responses` in order. Lets a
     * single test exercise multiple back-to-back GitHub calls (connect →
     * connectRepo → probe …) without re-stubbing between them.
     */
    function queuedFetch(responses: MockResponseSpec[]) {
      let i = 0;
      return vi.fn(async () => {
        const spec = responses[i++];
        if (!spec) throw new Error(`No more mocked responses (call #${i})`);
        return new Response(JSON.stringify(spec.body), {
          status: spec.status ?? 200,
          headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
        });
      });
    }

    it('connect with `repo` scope sets capability=true (classic PAT — no probe needed)', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo' },
        }),
      );
      const session = await useWorkspaceStore.getState().connectGitHubSession('tok');
      expect(session.canCreatePullRequests).toBe(true);
    });

    it('connect with both `repo` and `pull_request` sets capability=true', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo, pull_request' },
        }),
      );
      const session = await useWorkspaceStore.getState().connectGitHubSession('tok');
      expect(session.canCreatePullRequests).toBe(true);
    });

    it('connectRepo probes `/pulls` when scope was inconclusive — flips to true on 200', async () => {
      // We need a fixture where connect succeeds but capability is null.
      // The connect flow mandates `repo` so `null` is impossible via the
      // normal entry path; setState() the session directly to model the
      // post-hydrate state of a fine-grained PAT whose scopes don't surface
      // via x-oauth-scopes.
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo' },
        }),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      // Force capability to null so connectRepo's probe path runs.
      const local0 = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: {
          ...local0,
          sessions: {
            github: {
              ...local0.sessions.github,
              workspace: { ...local0.sessions.github.workspace!, canCreatePullRequests: null },
            },
          },
        },
      });

      // connectRepo: 1) GET /repos/me/api → repo, 2) GET /repos/me/api/pulls → 200 list
      vi.unstubAllGlobals();
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          {
            body: {
              full_name: 'me/api',
              name: 'api',
              owner: { login: 'me' },
              default_branch: 'main',
              visibility: 'public',
              permissions: { push: true, admin: false },
            },
          },
          { body: [] }, // empty PR list — probe sees a 200 and flips capability=true
        ]),
      );
      await useWorkspaceStore.getState().connectRepo('me', 'api');
      const after = useWorkspaceStore.getState().local!.sessions.github.workspace!;
      expect(after.canCreatePullRequests).toBe(true);
    });

    it('connectRepo probe returning 403 missing-scope flips capability to false', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo' },
        }),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      const local0 = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: {
          ...local0,
          sessions: {
            github: {
              ...local0.sessions.github,
              workspace: { ...local0.sessions.github.workspace!, canCreatePullRequests: null },
            },
          },
        },
      });

      vi.unstubAllGlobals();
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          {
            body: {
              full_name: 'me/api',
              name: 'api',
              owner: { login: 'me' },
              default_branch: 'main',
              visibility: 'public',
              permissions: { push: true, admin: false },
            },
          },
          {
            // 403 with accepted-oauth-scopes hint → MissingScopeError → false
            status: 403,
            body: { message: 'Resource not accessible' },
            headers: { 'x-accepted-oauth-scopes': 'repo, pull_request' },
          },
        ]),
      );
      await useWorkspaceStore.getState().connectRepo('me', 'api');
      const after = useWorkspaceStore.getState().local!.sessions.github.workspace!;
      expect(after.canCreatePullRequests).toBe(false);
    });

    it('connectRepo with already-true capability skips the probe entirely', async () => {
      // Connect → capability already true via scope check. Then connectRepo
      // should issue exactly ONE GitHub call (getRepo), not two.
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo' },
        }),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');

      vi.unstubAllGlobals();
      const fetchMock = queuedFetch([
        {
          body: {
            full_name: 'me/api',
            name: 'api',
            owner: { login: 'me' },
            default_branch: 'main',
            visibility: 'public',
            permissions: { push: true, admin: false },
          },
        },
        // No second entry — if the probe ran the queue would throw "no more
        // mocked responses" and the test would fail loudly.
      ]);
      vi.stubGlobal('fetch', fetchMock);
      await useWorkspaceStore.getState().connectRepo('me', 'api');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('verifyGitHubScopes re-runs the probe against the connected repo', async () => {
      // Connect → capability=true via scope.
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo' },
        }),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');

      // connectRepo (no probe needed since capability already true).
      vi.unstubAllGlobals();
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: {
            full_name: 'me/api',
            name: 'api',
            owner: { login: 'me' },
            default_branch: 'main',
            visibility: 'public',
            permissions: { push: true, admin: false },
          },
        }),
      );
      await useWorkspaceStore.getState().connectRepo('me', 'api');

      // Now: user revoked their `repo` scope on github.com. verifyGitHubScopes
      // re-fetches scopes, finds them empty, falls back to the probe (which
      // 403s), and flips capability=false.
      vi.unstubAllGlobals();
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          {
            body: { login: 'me', id: 1 },
            headers: { 'x-oauth-scopes': 'gist' }, // neither repo nor pull_request
          },
          {
            status: 403,
            body: { message: 'Resource not accessible' },
            headers: { 'x-accepted-oauth-scopes': 'repo, pull_request' },
          },
        ]),
      );
      await useWorkspaceStore.getState().verifyGitHubScopes();
      const after = useWorkspaceStore.getState().local!.sessions.github.workspace!;
      expect(after.canCreatePullRequests).toBe(false);
    });

    it('updateGitHubToken re-resolves capability with the new token', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo' },
        }),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok-old');

      // Rotate to a token that grants pull_request directly (fine-grained-style).
      vi.unstubAllGlobals();
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          body: { login: 'me', id: 1 },
          headers: { 'x-oauth-scopes': 'repo, pull_request' },
        }),
      );
      const updated = await useWorkspaceStore.getState().updateGitHubToken('tok-new');
      expect(updated.canCreatePullRequests).toBe(true);
    });
  });
});
