import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GitHostAccessProvider } from './gitHostAccess';
import { GitHostLockedNotice } from './GitHostLockedNotice';

describe('GitHostLockedNotice', () => {
  it('names the host and says nothing was deleted, with nowhere to click', () => {
    render(<GitHostLockedNotice host="azure-devops" />);
    expect(screen.getByText(/Azure DevOps isn.t available on this plan/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been deleted/)).toBeInTheDocument();
    // A dead "Upgrade" button is worse than none: the default offers no action.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it("renders the edition's notice instead when it supplies one", () => {
    render(
      <GitHostAccessProvider
        value={{
          lockedHosts: ['gitlab'],
          lockedNotice: <button type="button">Upgrade</button>,
        }}
      >
        <GitHostLockedNotice host="gitlab" />
      </GitHostAccessProvider>,
    );
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
    expect(screen.queryByText(/isn.t available on this plan/)).not.toBeInTheDocument();
  });
});
