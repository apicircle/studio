import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DESKTOP_RELEASES_URL, DesktopAppLink } from './desktopDownload';
import { DESKTOP_DOWNLOAD_URL, LENS_URL } from './externalLinks';

describe('the website links', () => {
  it('names the download page and the Lens page on apicircle.dev', () => {
    expect(DESKTOP_DOWNLOAD_URL).toBe('https://apicircle.dev/download');
    expect(LENS_URL).toBe('https://apicircle.dev/lens');
  });

  it('keeps the exported legacy name, pointing at the download page', () => {
    expect(DESKTOP_RELEASES_URL).toBe(DESKTOP_DOWNLOAD_URL);
  });
});

describe('DesktopAppLink', () => {
  it("opens the website's download page in a new tab, inline by default", () => {
    render(<DesktopAppLink />);
    const link = screen.getByRole('link', { name: 'Desktop App' });
    expect(link).toHaveAttribute('href', 'https://apicircle.dev/download');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.className).toMatch(/underline-offset-2/);
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('reads as an action in the button variant, with its own text', () => {
    render(<DesktopAppLink variant="button">Get the desktop app</DesktopAppLink>);
    const link = screen.getByRole('link', { name: 'Get the desktop app' });
    expect(link).toHaveAttribute('href', 'https://apicircle.dev/download');
    expect(link.className).toMatch(/border-accent/);
    expect(link.querySelector('svg')).not.toBeNull();
  });

  it('takes an icon of its own, or none', () => {
    const { unmount } = render(<DesktopAppLink icon={<span data-testid="own-icon" />} />);
    expect(screen.getByTestId('own-icon')).toBeInTheDocument();
    unmount();
    render(<DesktopAppLink icon={null} />);
    expect(screen.getByRole('link', { name: 'Desktop App' }).querySelector('svg')).toBeNull();
  });
});
