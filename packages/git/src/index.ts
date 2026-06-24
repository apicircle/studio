export { GitHubClient } from './github/api';
export type {
  CreatedBlob,
  CreatedCommit,
  BinaryFileContents,
  CreatedTree,
  FileContents,
  GitCommitSummary,
  GitHubBranch,
  GitHubClientOptions,
  GitHubRepo,
  GitHubViewer,
  GitRef,
  MarketplaceRepo,
  PullRequestSummary,
  ScopeInfo,
  TreeEntryInput,
} from './github/api';
export {
  BranchDivergedError,
  GitHubError,
  MissingScopeError,
  RateLimitedError,
  TimeoutError,
  UnauthorizedError,
} from './github/errors';
export {
  getGitProvider,
  gitHostKindFromOrigin,
  hasGitProvider,
  registerGitProvider,
  resetGitProviderRegistry,
} from './provider';
export type {
  GitHostKind,
  GitProvider,
  GitProviderFactory,
  GitProviderMethod,
  GitProviderOptions,
} from './provider';
