import { describe, expect, it } from 'vitest';
import type { UnpushedChange, UnpushedSummary } from '@apicircle/core';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { describeStudioChanges, studioHasPendingChanges } from './branchPush';
import { addEnvironment } from './envActions';
import { useWorkspaceStore } from './workspaceStore';

function summary(changes: Partial<UnpushedChange>[]): UnpushedSummary {
  const full = changes.map((c) => ({
    bucket: 'request',
    key: 'k',
    label: 'GET /users',
    kind: 'modified',
    base: null,
    local: null,
    ...c,
  })) as UnpushedChange[];
  return {
    added: full.filter((c) => c.kind === 'added').length,
    modified: full.filter((c) => c.kind === 'modified').length,
    removed: full.filter((c) => c.kind === 'removed').length,
    total: full.length,
    changes: full,
    computedAt: 't',
  };
}

describe('describeStudioChanges', () => {
  it('says nothing for an unchanged workspace', () => {
    expect(describeStudioChanges(summary([]))).toBeNull();
  });

  it('lists each change under a heading, by kind and entity', () => {
    expect(
      describeStudioChanges(
        summary([
          { kind: 'added', bucket: 'environment', label: 'Staging' },
          { kind: 'modified', bucket: 'request', label: 'GET /users' },
          { kind: 'removed', bucket: 'mockServer', label: 'Old mock' },
        ]),
      ),
    ).toBe(
      [
        '## Studio changes',
        '',
        '- Added environment `Staging`',
        '- Changed request `GET /users`',
        '- Removed mock server `Old mock`',
      ].join('\n'),
    );
  });

  it('names a singleton by what it is, without repeating its label', () => {
    expect(
      describeStudioChanges(
        summary([
          {
            kind: 'modified',
            bucket: 'environmentsPriority',
            key: '',
            label: 'Environment priority',
          },
        ]),
      ),
    ).toBe(['## Studio changes', '', '- Changed environment priority'].join('\n'));
  });

  it('keeps a label with backticks inside a code span it cannot close', () => {
    const md = describeStudioChanges(summary([{ label: 'say `hi`' }]))!;
    expect(md).toContain('- Changed request `` say `hi` ``');
    expect(describeStudioChanges(summary([{ label: 'a``b' }]))).toContain('```a``b```');
  });

  it('stops a long list and says how many more there are', () => {
    const md = describeStudioChanges(
      summary(Array.from({ length: 5 }, (_, i) => ({ label: `r${i}` }))),
      3,
    )!;
    expect(md.split('\n')).toEqual([
      '## Studio changes',
      '',
      '- Changed request `r0`',
      '- Changed request `r1`',
      '- Changed request `r2`',
      '- …and 2 more',
    ]);
  });
});

describe('studioHasPendingChanges', () => {
  // A real document: the diff walks every collection a workspace carries.
  async function realSynced(): Promise<WorkspaceSynced> {
    await useWorkspaceStore.getState().hydrate();
    return useWorkspaceStore.getState().synced!;
  }
  const local = (synced: WorkspaceSynced, over: Partial<WorkspaceLocal> = {}): WorkspaceLocal =>
    ({ sync: { lastPulledSnapshot: synced }, ...over }) as unknown as WorkspaceLocal;

  it('is false when the document matches the last pull and nothing is queued', async () => {
    const synced = await realSynced();
    expect(studioHasPendingChanges(local(synced), synced)).toBe(false);
  });

  it('counts queued attachment deletes and uploads', async () => {
    const synced = await realSynced();
    expect(
      studioHasPendingChanges(local(synced, { pendingAttachmentDeletes: ['s1'] }), synced),
    ).toBe(true);
    expect(
      studioHasPendingChanges(
        local(synced, {
          pendingFileUploads: { a: {} } as unknown as WorkspaceLocal['pendingFileUploads'],
        }),
        synced,
      ),
    ).toBe(true);
  });

  it('counts a change to the document since the last pull', async () => {
    const synced = await realSynced();
    expect(studioHasPendingChanges(local(synced), addEnvironment(synced, 'Staging'))).toBe(true);
  });
});
