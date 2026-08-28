import { describe, expect, it } from 'vitest';
import {
  isRepoCoordinateComplete,
  parseRepoCoordinate,
  REPO_HINT,
  REPO_PLACEHOLDER,
  splitRepoFullName,
} from './repoCoordinate';

// The connect form used one flat rule — split on '/', reject anything that is
// not exactly two parts. That is right for two of the four hosts and wrong for
// the other two, so a legitimate GitLab subgroup could not be entered at all and
// an Azure DevOps user had no way to learn where their organisation goes.

describe('parseRepoCoordinate', () => {
  it('parses the two-part hosts', () => {
    expect(parseRepoCoordinate('acme/api', 'github')).toEqual({
      ok: true,
      owner: 'acme',
      name: 'api',
    });
    expect(parseRepoCoordinate('team/api', 'bitbucket')).toEqual({
      ok: true,
      owner: 'team',
      name: 'api',
    });
  });

  it('folds a GitLab SUBGROUP path into owner, which is what the client encodes', () => {
    // `GitLabClient.project()` is `encodeURIComponent(`${owner}/${name}`)`, so a
    // subgroup is simply an owner containing slashes. This was rejected outright.
    expect(parseRepoCoordinate('group/subgroup/project', 'gitlab')).toEqual({
      ok: true,
      owner: 'group/subgroup',
      name: 'project',
    });
    expect(parseRepoCoordinate('a/b/c/d/repo', 'gitlab')).toEqual({
      ok: true,
      owner: 'a/b/c/d',
      name: 'repo',
    });
  });

  it('still accepts a plain two-part GitLab path', () => {
    expect(parseRepoCoordinate('group/project', 'gitlab')).toEqual({
      ok: true,
      owner: 'group',
      name: 'project',
    });
  });

  it('REJECTS a three-part Azure coordinate, because the org belongs in the base URL', () => {
    // Azure's client builds `/{owner}/_apis/git/repositories/{name}` against a
    // base URL carrying the organisation. Folding an org into `owner` would
    // produce a URL that addresses nothing — so this has to be a rejection with
    // an explanation, not a silent reinterpretation.
    const result = parseRepoCoordinate('my-org/my-project/api', 'azure-devops');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('project/repo');
    expect(REPO_HINT['azure-devops']).toContain('API base URL');
  });

  it('accepts the two-part Azure coordinate', () => {
    expect(parseRepoCoordinate('my-project/api', 'azure-devops')).toEqual({
      ok: true,
      owner: 'my-project',
      name: 'api',
    });
  });

  it('rejects a single segment on every host, naming that host shape', () => {
    for (const host of ['github', 'gitlab', 'bitbucket', 'azure-devops'] as const) {
      const result = parseRepoCoordinate('justrepo', host);
      expect(result.ok).toBe(false);
      // The message must name THIS host's shape — "Format must be `owner/name`"
      // is actively misleading on a host where it is not owner/name.
      expect(result.ok === false && result.error).toContain(REPO_PLACEHOLDER[host]);
    }
  });

  it('tolerates surrounding and trailing slashes rather than failing on a paste', () => {
    expect(parseRepoCoordinate('  /acme/api/  ', 'github')).toEqual({
      ok: true,
      owner: 'acme',
      name: 'api',
    });
  });

  it('rejects an interior empty segment, which no path means', () => {
    expect(parseRepoCoordinate('acme//api', 'gitlab').ok).toBe(false);
  });

  it('rejects empty input with the host shape, not a bare error', () => {
    const result = parseRepoCoordinate('   ', 'gitlab');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('group/subgroup/project');
  });

  it('isRepoCoordinateComplete agrees with the parser', () => {
    expect(isRepoCoordinateComplete('group/sub/proj', 'gitlab')).toBe(true);
    expect(isRepoCoordinateComplete('group/sub/proj', 'github')).toBe(false);
  });
});

// The splitter itself is tested in `@apicircle/shared`; what belongs HERE is
// that the parser and the splitter agree — whatever the form produces must
// come back out of storage unchanged.
describe('splitRepoFullName round-trip', () => {
  it('round-trips what parseRepoCoordinate produced', () => {
    for (const [input, host] of [
      ['acme/api', 'github'],
      ['team/api', 'bitbucket'],
      ['group/subgroup/project', 'gitlab'],
      ['my-project/api', 'azure-devops'],
    ] as const) {
      const parsed = parseRepoCoordinate(input, host);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(splitRepoFullName(`${parsed.owner}/${parsed.name}`)).toEqual({
        owner: parsed.owner,
        name: parsed.name,
      });
    }
  });
});
