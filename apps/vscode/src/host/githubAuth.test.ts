import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { SecretStorage } from 'vscode';
import type { LinkedWorkspace } from '@apicircle/shared';
import { authentication } from '../../test/mocks/vscode';
import {
  linkSessionSecretKey,
  linkedSecretStorageKey,
  getGitHubToken,
  getLinkToken,
} from './githubAuth';

function reset(): void {
  (authentication.getSession as Mock).mockReset();
}

describe('linkSessionSecretKey', () => {
  it('returns a deterministic per-link namespace', () => {
    expect(linkSessionSecretKey('link-1')).toBe('apicircle.linkSession.link-1');
    expect(linkSessionSecretKey('link-2')).not.toBe(linkSessionSecretKey('link-1'));
  });
});

describe('linkedSecretStorageKey', () => {
  it('namespaces by link id AND key id', () => {
    expect(linkedSecretStorageKey('link-1', 'key-A')).toBe('apicircle.linkedSecret.link-1.key-A');
    expect(linkedSecretStorageKey('link-1', 'key-B')).not.toBe(
      linkedSecretStorageKey('link-1', 'key-A'),
    );
  });
});

describe('getGitHubToken', () => {
  beforeEach(reset);

  it('returns the session token when present (silent mode)', async () => {
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh_abc' });
    const out = await getGitHubToken(false);
    expect(out).toBe('gh_abc');
    expect(authentication.getSession).toHaveBeenCalledWith(
      'github',
      ['repo'],
      expect.objectContaining({ createIfNone: false, silent: true }),
    );
  });

  it('uses createIfNone=true when interactive', async () => {
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh_xyz' });
    const out = await getGitHubToken(true);
    expect(out).toBe('gh_xyz');
    expect(authentication.getSession).toHaveBeenCalledWith(
      'github',
      ['repo'],
      expect.objectContaining({ createIfNone: true, silent: false }),
    );
  });

  it('returns null when no session is available', async () => {
    (authentication.getSession as Mock).mockResolvedValueOnce(undefined);
    expect(await getGitHubToken(false)).toBeNull();
  });

  it('returns null when the auth provider throws (cancelled / missing provider)', async () => {
    (authentication.getSession as Mock).mockRejectedValueOnce(new Error('cancelled'));
    expect(await getGitHubToken(true)).toBeNull();
  });
});

function makeSecrets(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    get: vi.fn(async (k: string) => store.get(k)),
    store: vi.fn(),
    delete: vi.fn(),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as SecretStorage;
}

function makeLink(
  over: Partial<LinkedWorkspace['source']> = {},
  linkOver: Partial<LinkedWorkspace> = {},
): LinkedWorkspace {
  return {
    id: 'link-1',
    kind: 'public',
    source: {
      repoFullName: 'owner/repo',
      branch: 'main',
      sessionMode: 'shared',
      ...over,
    },
    ...linkOver,
  } as unknown as LinkedWorkspace;
}

describe('getLinkToken', () => {
  beforeEach(reset);

  it('reads SecretStorage when the link uses a dedicated session', async () => {
    const link = makeLink({ sessionMode: 'dedicated' });
    const secrets = makeSecrets({ [linkSessionSecretKey(link.id)]: 'pat-abc' });
    expect(await getLinkToken(secrets, link)).toBe('pat-abc');
  });

  it('returns null when a dedicated link has no stored PAT', async () => {
    const link = makeLink({ sessionMode: 'dedicated' });
    const secrets = makeSecrets();
    expect(await getLinkToken(secrets, link)).toBeNull();
  });

  it('falls through to the silent GitHub session for shared public links', async () => {
    const link = makeLink({ sessionMode: 'workspace' });
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'ses_silent' });
    expect(await getLinkToken(makeSecrets(), link)).toBe('ses_silent');
    expect(authentication.getSession).toHaveBeenCalledWith(
      'github',
      ['repo'],
      expect.objectContaining({ silent: true }),
    );
  });

  it('uses an interactive GitHub session for shared private links', async () => {
    const link = makeLink({ sessionMode: 'workspace' }, { kind: 'private' as never });
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'ses_interactive' });
    expect(await getLinkToken(makeSecrets(), link)).toBe('ses_interactive');
    expect(authentication.getSession).toHaveBeenCalledWith(
      'github',
      ['repo'],
      expect.objectContaining({ createIfNone: true, silent: false }),
    );
  });
});
