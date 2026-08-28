import { describe, expect, it } from 'vitest';
import { splitRepoFullName } from './repoFullName';

describe('splitRepoFullName', () => {
  it('splits the two-segment hosts', () => {
    expect(splitRepoFullName('acme/api')).toEqual({ owner: 'acme', name: 'api' });
  });

  it('does NOT drop the last segment of a GitLab subgroup path', () => {
    // `split('/', 2)` returned `{ owner: 'group', name: 'subgroup' }` here — it
    // discarded `project` and addressed a DIFFERENT repository, silently. That
    // is worse than a rejection, because nothing surfaces.
    expect(splitRepoFullName('group/subgroup/project')).toEqual({
      owner: 'group/subgroup',
      name: 'project',
    });
    expect(splitRepoFullName('a/b/c/d/repo')).toEqual({ owner: 'a/b/c/d', name: 'repo' });
  });

  it('reports an empty name rather than guessing when there is no separator', () => {
    // Not `{ owner: 'justrepo', name: 'justrepo' }` — the caller must fail on a
    // blank path rather than address a repo nobody asked for.
    expect(splitRepoFullName('justrepo')).toEqual({ owner: 'justrepo', name: '' });
  });

  it('keeps an empty string empty', () => {
    expect(splitRepoFullName('')).toEqual({ owner: '', name: '' });
  });
});
