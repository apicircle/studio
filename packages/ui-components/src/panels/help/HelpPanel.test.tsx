import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HelpPanel } from './HelpPanel';
import { HelpSidebar } from './HelpSidebar';
import { VISIBLE_HELP_SECTIONS } from './helpContent';
import { renderWithStore } from '../../../test/renderWithStore';

// After the minor-fixes pass, the search + section list moved into
// `HelpSidebar` (rendered by Sidebar.tsx in the standard resizable shell)
// and `HelpPanel` keeps just the article view. Tests render both so the
// shared workspace-store state (helpQuery, helpSectionId) ties them
// together exactly as it does at runtime.

function HelpFixture() {
  return (
    <>
      <HelpSidebar />
      <HelpPanel />
    </>
  );
}

describe('HelpPanel', () => {
  it('lists every section in the sidebar nav by default', async () => {
    await renderWithStore(<HelpFixture />);
    for (const expected of [
      'Welcome',
      'Workspace & Git',
      'Editor',
      'Environments',
      'Secret Vault',
      'Sessions',
      'Execution Plans',
      'History',
      'Keyboard Shortcuts',
      'Troubleshooting',
    ]) {
      expect(screen.getByRole('button', { name: expected })).toBeInTheDocument();
    }
  });

  it('shows the first matching section in the right pane on load', async () => {
    await renderWithStore(<HelpFixture />);
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome' })).toBeInTheDocument();
  });

  it('clicking a section in the rail switches the right pane', async () => {
    const user = userEvent.setup();
    await renderWithStore(<HelpFixture />);
    await user.click(screen.getByRole('button', { name: 'Editor' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Editor' })).toBeInTheDocument();
  });

  it('filters the rail via the search input', async () => {
    const user = userEvent.setup();
    await renderWithStore(<HelpFixture />);
    // 'hotkey' is a keyword on Keyboard Shortcuts and nowhere else. The
    // previous probe here was 'yank' → Release Management, an article this
    // build withholds.
    await user.type(screen.getByLabelText('Search help'), 'hotkey');
    expect(screen.getByRole('button', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Welcome' })).not.toBeInTheDocument();
  });

  it('lists neither withheld article, and finds nothing when searching for one', async () => {
    const user = userEvent.setup();
    await renderWithStore(<HelpFixture />);
    expect(screen.queryByRole('button', { name: 'Link Workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release Management' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Search help'), 'marketplace');
    expect(screen.queryByRole('button', { name: 'Link Workspace' })).not.toBeInTheDocument();
  });

  it('renders the empty state when nothing matches', async () => {
    const user = userEvent.setup();
    await renderWithStore(<HelpFixture />);
    await user.type(screen.getByLabelText('Search help'), 'zzz-no-such-thing-zzz');
    expect(screen.getAllByText('No matching sections.')[0]).toBeInTheDocument();
  });

  // The inline spans are compiled by one regex whose alternatives are tried
  // left to right, so a link nested inside bold used to be swallowed by the
  // bold branch and reach the reader as literal markdown — `[Desktop](https://
  // github.com/apicircle/studio/releases/latest)`, URL and all, mid-sentence in
  // the Environments article. The two tests below pin the fix from both sides:
  // no article leaks raw markdown, and a bold-wrapped link really is an anchor.
  //
  // Asserted over the WHOLE corpus rather than one hard-coded article, so the
  // guard keeps working when the copy moves and catches the next instance
  // wherever it is written.
  it('leaks no raw markdown link into any article', async () => {
    const user = userEvent.setup();
    await renderWithStore(<HelpFixture />);
    for (const section of VISIBLE_HELP_SECTIONS) {
      await user.click(screen.getByRole('button', { name: section.title }));
      const article = screen.getByRole('region');
      expect(
        article.textContent,
        `${section.title} renders an uncompiled markdown link`,
      ).not.toContain('](http');
    }
  });

  it('renders a link nested inside bold as an anchor within the bold span', async () => {
    const nested = VISIBLE_HELP_SECTIONS.filter((section) =>
      /\*\*\[[^\]]+\]\(https?:\/\/[^)]+\)\*\*/.test(section.body),
    );
    // A real example is what keeps this honest. If the copy that carried the
    // regression is ever reworded away, this fails rather than passing
    // vacuously — keep an example, or delete the test deliberately.
    expect(nested.length, 'no article nests a link inside bold any more').toBeGreaterThan(0);

    const user = userEvent.setup();
    await renderWithStore(<HelpFixture />);
    for (const section of nested) {
      await user.click(screen.getByRole('button', { name: section.title }));
      for (const [, href] of section.body.matchAll(/\*\*\[[^\]]+\]\((https?:\/\/[^)]+)\)\*\*/g)) {
        const anchor = screen
          .getByRole('region')
          .querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
        expect(anchor, `${section.title} does not link ${href}`).not.toBeNull();
        expect(anchor?.closest('strong'), `${href} is not inside its bold span`).not.toBeNull();
      }
    }
  });
});
