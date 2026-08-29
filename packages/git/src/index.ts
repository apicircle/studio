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
  IssueCommentSummary,
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
// Host metadata lives in `@apicircle/shared` (the published, dependency-free
// leaf that owns `GitHostKind`); re-exported here so a consumer already holding
// `@apicircle/git` does not need a second import for the host list or its labels.
export { GIT_HOST_KINDS, GIT_HOST_LABELS } from '@apicircle/shared';
export type {
  GitHostKind,
  GitProvider,
  GitProviderFactory,
  GitProviderMethod,
  GitProviderOptions,
} from './provider';
export { supportsGitMethod, unsupportedGitMethods } from './capabilities';
