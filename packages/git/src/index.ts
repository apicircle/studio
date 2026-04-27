export { GitHubClient } from './github/api';
export type {
  GitHubBranch,
  GitHubClientOptions,
  GitHubRepo,
  GitHubViewer,
  ScopeInfo,
} from './github/api';
export {
  GitHubError,
  MissingScopeError,
  RateLimitedError,
  UnauthorizedError,
} from './github/errors';
