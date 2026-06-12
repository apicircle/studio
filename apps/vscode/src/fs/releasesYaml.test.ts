import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import type { ReleaseHistory, ReleaseVersion } from '@apicircle/shared';
import { releaseStatus, serializeReleasesToYaml } from './releasesYaml';

function entry(version: string, partial: Partial<ReleaseVersion> = {}): ReleaseVersion {
  return {
    version,
    publishedAt: '2026-06-01T00:00:00.000Z',
    notes: '',
    workspaceSnapshot: 'abcdef0123456789'.repeat(4),
    deprecated: false,
    yanked: false,
    ...partial,
  };
}

describe('releaseStatus', () => {
  it('maps the flag combinations', () => {
    expect(releaseStatus({ deprecated: false, yanked: false })).toBe('published');
    expect(releaseStatus({ deprecated: true, yanked: false })).toBe('deprecated');
    expect(releaseStatus({ deprecated: false, yanked: true })).toBe('withdrawn');
    expect(releaseStatus({ deprecated: true, yanked: true })).toBe('deprecated+withdrawn');
  });
});

describe('serializeReleasesToYaml', () => {
  it('renders an empty ledger with a null currentVersion', () => {
    const text = serializeReleasesToYaml(null);
    const parsed = YAML.parse(text) as { currentVersion: string | null; versions: unknown[] };
    expect(parsed.currentVersion).toBeNull();
    expect(parsed.versions).toEqual([]);
    expect(text).toContain('▶ Publish release…');
  });

  it('lists versions newest-first with status + short snapshot', () => {
    const ledger: ReleaseHistory = {
      currentVersion: '1.2.0',
      versions: [entry('1.0.0', { deprecated: true }), entry('1.2.0', { notes: 'new stuff' })],
    };
    const text = serializeReleasesToYaml(ledger);
    const parsed = YAML.parse(text) as {
      currentVersion: string;
      versions: Array<{ version: string; status: string; snapshot: string; notes?: string }>;
    };
    expect(parsed.currentVersion).toBe('1.2.0');
    expect(parsed.versions.map((v) => v.version)).toEqual(['1.2.0', '1.0.0']);
    expect(parsed.versions[1].status).toBe('deprecated');
    expect(parsed.versions[0].notes).toBe('new stuff');
    // Snapshot is truncated, not the full 64-char hash.
    expect(parsed.versions[0].snapshot).toMatch(/^[0-9a-f]{12}…$/);
  });

  it('omits notes when empty', () => {
    const ledger: ReleaseHistory = { currentVersion: '1.0.0', versions: [entry('1.0.0')] };
    const parsed = YAML.parse(serializeReleasesToYaml(ledger)) as {
      versions: Array<{ notes?: string }>;
    };
    expect(parsed.versions[0].notes).toBeUndefined();
  });
});
