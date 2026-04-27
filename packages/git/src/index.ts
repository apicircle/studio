export { GitHubClient } from './github/api';
export type { GitHubClientOptions, GitHubViewer, ScopeInfo } from './github/api';
export {
  GitHubError,
  MissingScopeError,
  RateLimitedError,
  UnauthorizedError,
} from './github/errors';
