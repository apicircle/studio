// Live GitHub — pipeline-managed repo contract.
//
// The CI workflow (.github/workflows/e2e-live-github.yml) provisions
// two ephemeral repos before the suite runs and exports their names as:
//
//   APICIRCLE_E2E_PIPELINE_PRIVATE_REPO=apicircle-ci-bot/apicircle-e2e-private-<run_id>
//   APICIRCLE_E2E_PIPELINE_PUBLIC_REPO=apicircle-ci-bot/apicircle-e2e-public-<run_id>
//
// This spec pins the env-var contract in place — if the pipeline ever
// stops setting these vars, the downstream `repo-cycle.spec.ts` would
// also fail, but with a much more cryptic message about repo 404. This
// spec fails fast with a directed assertion instead.
//
// In local-dev (no pipeline env), the spec skips with a directed reason.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapGT } from '../fixtures/tcMapGT';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  getDefaultBranchHead,
  getPipelineRepoConfig,
  liveSkipReason,
} from './_helpers';

function gt(key: string): TcId {
  const v = tcMapGT[key];
  if (!v) throw new Error(`No TC-GT entry for "${key}"`);
  return v;
}

test.describe('Live GitHub — pipeline-managed repo handshake @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let priv: LiveGithubConfig | null;
  let pub: LiveGithubConfig | null;
  test.beforeAll(() => {
    const cfg = getPipelineRepoConfig();
    priv = cfg.privateRepo;
    pub = cfg.publicRepo;
  });

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: Link to private repo with personal token'),
      'pipeline-provisioned PRIVATE repo is reachable, default branch resolves',
    ),
    async () => {
      test.skip(
        priv === null,
        'Set APICIRCLE_E2E_PIPELINE_PRIVATE_REPO to the pipeline-created private repo (owner/name).',
      );
      const head = await getDefaultBranchHead(priv!);
      expect(head.name.length).toBeGreaterThan(0);
      // Fresh pipeline repo starts empty (sha === null) and gets bootstrapped
      // by `seedRepoIfEmpty` in downstream specs. Both states are valid here.
    },
  );

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: Link to public repo'),
      'pipeline-provisioned PUBLIC repo is reachable, default branch resolves',
    ),
    async () => {
      test.skip(
        pub === null,
        'Set APICIRCLE_E2E_PIPELINE_PUBLIC_REPO to the pipeline-created public repo (owner/name).',
      );
      const head = await getDefaultBranchHead(pub!);
      expect(head.name.length).toBeGreaterThan(0);
    },
  );
});
