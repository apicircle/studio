export { GitHubClient } from './github/api';
export type {
  CreatedCommit,
  CreatedTree,
  GitCommitSummary,
  GitHubBranch,
  GitHubClientOptions,
  GitHubRepo,
  GitHubViewer,
  GitRef,
  ScopeInfo,
  TreeEntryInput,
} from './github/api';
export {
  GitHubError,
  MissingScopeError,
  RateLimitedError,
  UnauthorizedError,
} from './github/errors';
