import { createContext, useContext, type ReactNode } from 'react';

// What an edition adds to the confirmation shown before the workspace's
// repository is disconnected.
//
// Disconnecting a repository drops the repo connection and the working branch
// state that goes with it. That much the shell knows, and says. An edition may
// keep more that is about that one repository, and reset it when the repository
// goes (Lens: the folder its Code graph reads, the branch in view, the Spec it
// checks against). The shell cannot know what that is, so the edition says it
// here, and the shell shows it in both places a repository is disconnected from:
//
//   - the repository card's own "Disconnect repo";
//   - the session card of the host the repository is on, whose Disconnect takes
//     the repository with it. A session on any other host takes no repository,
//     so its confirmation does not show this.
//
// Omitted → nothing is added, and both confirmations read as Studio's own.

const RepoDisconnectNoticeContext = createContext<ReactNode>(null);

export const RepoDisconnectNoticeProvider = RepoDisconnectNoticeContext.Provider;

export function useRepoDisconnectNotice(): ReactNode {
  return useContext(RepoDisconnectNoticeContext);
}
