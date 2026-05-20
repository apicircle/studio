// Tests for the store action `recheckRetiredBranch`. Exercises the
// three discriminated outcomes (restored / still-retired / error) plus
// the side-effect on `local.workingBranch` + `local.retiredBranch`.

import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetiredBranch } from '@apicircle/shared';
import { useWorkspaceStore } from './workspaceStore';

interface ResponseSpec {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function fakeResponse(spec: ResponseSpec): Response {
  return new Response(JSON.stringify(spec.body), {
    status: spec.status ?? 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
  });
}

function queuedFetch(queue: ResponseSpec[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(async () => {
    if (i >= queue.length) throw new Error(`unexpected fetch call #${i + 1}`);
    return fakeResponse(queue[i++]);
  });
}

/**
 * Seed enough state for `recheckRetiredBranch` to do something:
 *  - connected GitHub session (so decryptSessionToken resolves)
 *  - connected repo (so probe knows where to query)
 *  - `local.retiredBranch` populated
 *  - `local.workingBranch` cleared
 */
async function setupRetiredWorkspace(retired: RetiredBranch) {
  vi.stubGlobal(
    'fetch',
    queuedFetch([
      { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, pull_request' } },
      {
        body: {
          full_name: 'me/api',
          name: 'api',
          owner: { login: 'me' },
          default_branch: 'main',
          permissions: { push: true, admin: false },
        },
      },
      { body: { name: 'main', commit: { sha: 'sha-main' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
    ]),
  );
  await useWorkspaceStore.getState().connectGitHubSession('tok');
  await useWorkspaceStore.getState().connectRepo('me', 'api');
  await useWorkspaceStore.getState().createWorkingBranch({ branchName: 'apicircle/wb-aaa' });
  vi.unstubAllGlobals();

  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    local: {
      ...local,
      workingBranch: null,
      retiredBranch: retired,
    },
  });
}

describe('workspaceStore.recheckRetiredBranch', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns still-retired/inconclusive when no retiredBranch is set', async () => {
    const result = await useWorkspaceStore.getState().recheckRetiredBranch();
    expect(result.status).toBe('still-retired');
  });

  it('restores the working branch when the branch is alive again and the PR is not merged', async () => {
    await setupRetiredWorkspace({
      branchName: 'apicircle/wb-aaa',
      reason: 'branch-deleted',
      retiredAt: '2026-05-01T00:00:00Z',
      prUrl: null,
      prNumber: null,
    });

    vi.stubGlobal(
      'fetch',
      queuedFetch([
        // getBranchHead probe — branch is alive again with a new HEAD
        { body: { name: 'apicircle/wb-aaa', commit: { sha: 'sha-revived' } } },
      ]),
    );

    const result = await useWorkspaceStore.getState().recheckRetiredBranch();
    expect(result.status).toBe('restored');
    if (result.status === 'restored') {
      expect(result.branchName).toBe('apicircle/wb-aaa');
      expect(result.headSha).toBe('sha-revived');
    }
    const local = useWorkspaceStore.getState().local!;
    expect(local.workingBranch).not.toBeNull();
    expect(local.workingBranch!.name).toBe('apicircle/wb-aaa');
    expect(local.workingBranch!.headSha).toBe('sha-revived');
    // lastPushedSha is reset — the user must refresh to know what changed.
    expect(local.workingBranch!.lastPushedSha).toBeNull();
    expect(local.retiredBranch).toBeNull();
  });

  it('reports still-retired/merged when the PR is still merged', async () => {
    await setupRetiredWorkspace({
      branchName: 'apicircle/wb-aaa',
      reason: 'pr-merged',
      retiredAt: '2026-05-01T00:00:00Z',
      prUrl: 'https://github.com/me/api/pull/42',
      prNumber: 42,
    });

    vi.stubGlobal(
      'fetch',
      queuedFetch([
        // getBranchHead — branch still alive (merge didn't delete)
        { body: { name: 'apicircle/wb-aaa', commit: { sha: 'sha-still' } } },
        // getPullRequest — still merged
        {
          body: {
            number: 42,
            html_url: 'https://github.com/me/api/pull/42',
            state: 'closed',
            merged: true,
            title: 't',
          },
        },
      ]),
    );

    const result = await useWorkspaceStore.getState().recheckRetiredBranch();
    expect(result.status).toBe('still-retired');
    if (result.status === 'still-retired') {
      expect(result.reason).toBe('merged');
    }
    // Local state unchanged.
    const local = useWorkspaceStore.getState().local!;
    expect(local.workingBranch).toBeNull();
    expect(local.retiredBranch).not.toBeNull();
  });

  it('reports still-retired/deleted when the branch is still gone', async () => {
    await setupRetiredWorkspace({
      branchName: 'apicircle/wb-aaa',
      reason: 'branch-deleted',
      retiredAt: '2026-05-01T00:00:00Z',
      prUrl: null,
      prNumber: null,
    });

    vi.stubGlobal(
      'fetch',
      queuedFetch([
        { body: { message: 'Not Found' }, status: 404 }, // getBranchHead 404
      ]),
    );

    const result = await useWorkspaceStore.getState().recheckRetiredBranch();
    expect(result.status).toBe('still-retired');
    if (result.status === 'still-retired') {
      expect(result.reason).toBe('deleted');
    }
  });
});
