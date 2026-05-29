import { expect, test } from '../../fixtures/app';
import {
  connectAndBranchV2,
  createV2HostRepo,
  createV2SourceRepo,
  createV2Tracker,
  getV2BotConfig,
  makeV2BranchName,
  publishSourceVersionV2,
  v2SkipReason,
  waitForLinkedLedgerVersionV2,
} from './_helpers';

test.describe('V2 Live GitHub - release update flow @live-github-v2', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('applied pinned link advances pinnedVersion, declined link stays on old snapshot, flags stay visible', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'release-update-host');
    const source = await createV2SourceRepo(tracker, bot, 'release-update', 'private', {
      notes: '# V2 release-update v1\n\n- Initial notes.',
    });
    const branch = makeV2BranchName(test.info().workerIndex, 'release-update');
    await connectAndBranchV2(app, host, branch, tracker);

    const linked = await app.evaluate(
      async ({ repoFullName, sourceBranch }) => {
        const api = window.__apicircleStore!.getState() as any;
        const applied = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const declined = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const state = window.__apicircleStore!.getState() as any;
        return {
          appliedId: applied.id,
          declinedId: declined.id,
          notes: state.synced.releases.perLink[applied.id].versions[0]?.notes ?? '',
          appliedPin: state.synced.linkedWorkspaces[applied.id].pinnedVersion,
          declinedPin: state.synced.linkedWorkspaces[declined.id].pinnedVersion,
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch },
    );
    expect(linked.notes).toContain('Initial notes');
    expect(linked.appliedPin).toBe('1.0.0');
    expect(linked.declinedPin).toBe('1.0.0');

    await publishSourceVersionV2(source, 'release-update', { version: '1.1.0' });
    await waitForLinkedLedgerVersionV2(app, linked.declinedId, '1.1.0');
    await waitForLinkedLedgerVersionV2(app, linked.appliedId, '1.1.0');

    const afterAdopt = await app.evaluate(async ({ appliedId, declinedId }) => {
      const api = window.__apicircleStore!.getState() as any;
      await api.previewLinkedUpdateForLink(appliedId);
      await api.applyLinkedUpdateForLink({});
      const state = window.__apicircleStore!.getState() as any;
      const view = (id: string) => {
        const snapshot = state.local.linkedCollections[id];
        const request = Object.values(snapshot.collections.requests)[0] as any;
        const env = Object.values(snapshot.environments.items)[0] as any;
        return {
          pin: state.synced.linkedWorkspaces[id].pinnedVersion,
          ledger: state.synced.releases.perLink[id].currentVersion,
          requestUrl: request.url,
          envBaseUrl: env.variables.find((v: any) => v.key === 'BASE_URL')?.value,
        };
      };
      return { applied: view(appliedId), declined: view(declinedId) };
    }, linked);
    expect(afterAdopt.declined.ledger).toBe('1.1.0');
    expect(afterAdopt.declined.pin).toBe('1.0.0');
    expect(afterAdopt.declined.requestUrl).toContain('1.0.0');
    expect(afterAdopt.declined.envBaseUrl).toContain('1.0.0');
    expect(afterAdopt.applied.pin).toBe('1.1.0');
    expect(afterAdopt.applied.requestUrl).toContain('1.1.0');
    expect(afterAdopt.applied.envBaseUrl).toContain('1.1.0');

    await publishSourceVersionV2(source, 'release-update', {
      version: '1.2.0',
      deprecated: true,
      yanked: true,
    });
    await waitForLinkedLedgerVersionV2(app, linked.declinedId, '1.2.0');
    await waitForLinkedLedgerVersionV2(app, linked.appliedId, '1.2.0');
    const flagged = await app.evaluate(async ({ appliedId, declinedId }) => {
      const state = window.__apicircleStore!.getState() as any;
      const ledger = state.synced.releases.perLink[declinedId];
      const v12 = ledger.versions.find((v: any) => v.version === '1.2.0');
      const view = (id: string) => {
        const snapshot = state.local.linkedCollections[id];
        const request = Object.values(snapshot.collections.requests)[0] as any;
        const env = Object.values(snapshot.environments.items)[0] as any;
        return {
          pin: state.synced.linkedWorkspaces[id].pinnedVersion,
          requestUrl: request.url,
          envBaseUrl: env.variables.find((v: any) => v.key === 'BASE_URL')?.value,
        };
      };
      return {
        appliedBefore: view(appliedId),
        declined: view(declinedId),
        deprecated: v12?.deprecated ?? false,
        yanked: v12?.yanked ?? false,
      };
    }, linked);
    expect(flagged.declined.pin).toBe('1.0.0');
    expect(flagged.declined.requestUrl).toContain('1.0.0');
    expect(flagged.declined.envBaseUrl).toContain('1.0.0');
    expect(flagged.appliedBefore.pin).toBe('1.1.0');
    expect(flagged.appliedBefore.requestUrl).toContain('1.1.0');
    expect(flagged.appliedBefore.envBaseUrl).toContain('1.1.0');
    expect(flagged.deprecated).toBe(true);
    expect(flagged.yanked).toBe(true);

    const afterFlaggedAdopt = await app.evaluate(async ({ appliedId, declinedId }) => {
      const api = window.__apicircleStore!.getState() as any;
      await api.previewLinkedUpdateForLink(appliedId);
      await api.applyLinkedUpdateForLink({});
      const state = window.__apicircleStore!.getState() as any;
      const view = (id: string) => {
        const snapshot = state.local.linkedCollections[id];
        const request = Object.values(snapshot.collections.requests)[0] as any;
        const env = Object.values(snapshot.environments.items)[0] as any;
        return {
          pin: state.synced.linkedWorkspaces[id].pinnedVersion,
          requestUrl: request.url,
          envBaseUrl: env.variables.find((v: any) => v.key === 'BASE_URL')?.value,
        };
      };
      return { applied: view(appliedId), declined: view(declinedId) };
    }, linked);
    expect(afterFlaggedAdopt.applied.pin).toBe('1.2.0');
    expect(afterFlaggedAdopt.applied.requestUrl).toContain('1.2.0');
    expect(afterFlaggedAdopt.applied.envBaseUrl).toContain('1.2.0');
    expect(afterFlaggedAdopt.declined.pin).toBe('1.0.0');
    expect(afterFlaggedAdopt.declined.requestUrl).toContain('1.0.0');
    expect(afterFlaggedAdopt.declined.envBaseUrl).toContain('1.0.0');
  });
});
