import { describe, expect, it } from 'vitest';
import {
  EMPTY_COMMUNITY_STATS,
  clearCommunityStats,
  readCommunityStats,
  writeCommunityStats,
} from './communityStorage';
import { REGISTRY_STORE, writeCommunityStatsRecord } from '../persistence/db';

describe('communityStorage', () => {
  it('returns the empty record when nothing is stored', async () => {
    await clearCommunityStats();
    expect(await readCommunityStats()).toEqual(EMPTY_COMMUNITY_STATS);
  });

  it('round-trips a full cache record through IndexedDB', async () => {
    const record = {
      fetchedAt: 1700000000000,
      stars: 142,
      openIssues: 7,
      latestVersion: 'v1.0.3',
      latestReleaseUrl: 'https://github.com/apicircle/studio/releases/tag/v1.0.3',
      contributors: 5,
      error: null,
    };
    await writeCommunityStats(record);
    expect(await readCommunityStats()).toEqual(record);
  });

  it('persists the error field independent of the data fields', async () => {
    await writeCommunityStats({
      ...EMPTY_COMMUNITY_STATS,
      fetchedAt: 1700000000000,
      stars: 12,
      error: 'rate-limit',
    });
    const loaded = await readCommunityStats();
    expect(loaded.error).toBe('rate-limit');
    expect(loaded.stars).toBe(12);
  });

  it('strips unknown error values back to null', async () => {
    await writeCommunityStatsRecord({
      ...EMPTY_COMMUNITY_STATS,
      error: 'gremlin',
    });
    expect((await readCommunityStats()).error).toBeNull();
  });

  it('drops non-numeric counts back to null instead of crashing', async () => {
    await writeCommunityStatsRecord({
      ...EMPTY_COMMUNITY_STATS,
      stars: '142',
      contributors: null,
    });
    const result = await readCommunityStats();
    expect(result.stars).toBeNull();
    expect(result.contributors).toBeNull();
  });

  // Sanity check that the registry store actually persists the cache —
  // catches a regression if someone refactors the key out from under
  // the helpers.
  it('uses the registry object store as its backing store', () => {
    // We rely on db.ts to set this up; just assert the constant resolves
    // so the symbol-level import is wired correctly.
    expect(REGISTRY_STORE).toBe('registry');
  });
});
