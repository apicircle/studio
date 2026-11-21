import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

// The standalone app's name and its two ways out to the website:
//   - the header says "API Circle" (the product), and so does the tab title;
//   - a "Lens" link at the far end of the header opens the website's page about
//     the paid Lens features in a new tab;
//   - every offer of the desktop app leads to the website's download page.
// The website itself is never reached: each test answers apicircle.dev locally.

/** Answer every apicircle.dev page with a stub, so a test never needs the network. */
async function stubWebsite(app: Page): Promise<void> {
  await app.context().route('https://apicircle.dev/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>apicircle.dev stub</title><p>stub</p>',
    }),
  );
}

/** Click `link` and return the URL of the tab it opens. */
async function openedUrl(app: Page, click: () => Promise<void>): Promise<string> {
  const [popup] = await Promise.all([app.waitForEvent('popup'), click()]);
  await popup.waitForLoadState('domcontentloaded');
  const url = popup.url();
  await popup.close();
  return url;
}

test.describe('Brand: API Circle', () => {
  test('the header and the tab title name the product, API Circle', async ({ app }) => {
    await expect(app).toHaveTitle('API Circle');
    const header = app.locator('[data-top-bar-end]').locator('..');
    await expect(header.getByText('API Circle', { exact: true })).toBeVisible();
    // Studio's tagline stays under the name.
    await expect(header.getByText('Built in India. Open to world')).toBeVisible();
    // The retired name is nowhere in the header.
    await expect(header).not.toContainText('API Circle Studio');
  });

  test('the tour, replayed from the Help Center, welcomes the reader to API Circle', async ({
    app,
  }) => {
    await app.getByRole('button', { name: /^Help Center$/ }).click();
    await app.getByRole('button', { name: 'Re-launch onboarding tour' }).click();
    const tour = app.getByRole('dialog');
    await expect(tour.getByRole('heading', { name: 'Welcome to API Circle' })).toBeVisible();
    await expect(tour).not.toContainText('API Circle Studio');
  });
});

test.describe('Header: the Lens link', () => {
  test("opens the website's Lens page in a new tab", async ({ app }) => {
    await stubWebsite(app);
    const lens = app.getByRole('link', { name: 'Lens (opens in a new tab)' });
    await expect(lens).toBeVisible();
    await expect(lens).toHaveText('Lens (opens in a new tab)');
    await expect(lens).toHaveAttribute('href', 'https://apicircle.dev/lens');
    await expect(lens).toHaveAttribute('target', '_blank');
    await expect(lens).toHaveAttribute('rel', 'noopener noreferrer');

    // It sits at the far end of the header, before Help.
    const end = app.locator('[data-top-bar-end]');
    await expect(end.locator(':scope > *').first()).toContainText('Lens');
    await expect(end.getByRole('button', { name: 'Help Center' })).toBeVisible();

    // Hover says where it goes.
    await lens.hover();
    await expect(
      app.getByRole('tooltip', { name: 'What Lens adds, on apicircle.dev' }),
    ).toBeVisible();

    // A new tab on apicircle.dev/lens, and this one stays where it was.
    const url = await openedUrl(app, () => lens.click());
    expect(url).toBe('https://apicircle.dev/lens');
    await expect(app).toHaveURL(/localhost|127\.0\.0\.1/);
    await expect(app.getByText('API Circle', { exact: true })).toBeVisible();
  });

  test("is drawn in each theme's own readable colours, at rest and on hover, in every theme", async ({
    app,
  }) => {
    // The tokens are measured on every theme by apps/web's theme-contrast test;
    // this proves the built CSS draws the link in exactly those tokens.
    const lens = app.getByRole('link', { name: 'Lens (opens in a new tab)' });
    await expect(lens).toBeVisible();
    // A colour change eases in; measure where it lands, not where it starts.
    await app.addStyleTag({ content: '[data-lens-link] { transition: none !important; }' });
    const themes = await app.evaluate(() => {
      const ids = new Set<string>();
      for (const sheet of Array.from(document.styleSheets)) {
        for (const rule of Array.from(sheet.cssRules)) {
          const theme = (rule as CSSStyleRule).selectorText?.match(/\[data-theme="([^"]+)"\]/);
          if (theme) ids.add(theme[1]);
        }
      }
      return [...ids];
    });
    expect(themes.length).toBeGreaterThanOrEqual(60);

    const drawn = () =>
      app.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const rgb = (name: string, alpha = '') => {
          const channels = root.getPropertyValue(`--${name}`).trim().split(/\s+/).join(', ');
          return alpha ? `rgba(${channels}, ${alpha})` : `rgb(${channels})`;
        };
        const link = getComputedStyle(document.querySelector('[data-lens-link]') as Element);
        return {
          drawn: [link.color, link.backgroundColor, link.borderTopColor],
          rest: [rgb('text-primary'), rgb('surface'), rgb('border')],
          hover: [rgb('accent-fg'), rgb('accent', '0.1'), rgb('accent', '0.4')],
        };
      });

    const off: string[] = [];
    for (const theme of themes) {
      await app.evaluate((id) => document.documentElement.setAttribute('data-theme', id), theme);
      await app.mouse.move(0, 300);
      const atRest = await drawn();
      if (atRest.drawn.join() !== atRest.rest.join()) off.push(`${theme} at rest: ${atRest.drawn}`);
      await lens.hover();
      const hovered = await drawn();
      if (hovered.drawn.join() !== hovered.hover.join())
        off.push(`${theme} on hover: ${hovered.drawn}`);
    }
    expect(off).toEqual([]);
  });

  test('is reached by keyboard and opens with Enter', async ({ app }) => {
    await stubWebsite(app);
    const lens = app.getByRole('link', { name: 'Lens (opens in a new tab)' });
    await lens.focus();
    await expect(lens).toBeFocused();
    const url = await openedUrl(app, () => app.keyboard.press('Enter'));
    expect(url).toBe('https://apicircle.dev/lens');
  });
});

test.describe('Desktop downloads go to the website', () => {
  test("the Mocks panel's Desktop App link opens the download page", async ({ app }) => {
    await stubWebsite(app);
    await app.getByRole('button', { name: /^Mocks$/ }).click();
    await expect(app.getByText('No mock servers yet.', { exact: true })).toBeVisible();
    const link = app.getByRole('link', { name: 'Desktop App' }).first();
    await expect(link).toHaveAttribute('href', 'https://apicircle.dev/download');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(await openedUrl(app, () => link.click())).toBe('https://apicircle.dev/download');
  });

  test('the Help Center offers the API Circle desktop app from apicircle.dev', async ({ app }) => {
    await stubWebsite(app);
    await app.getByRole('button', { name: /^Help Center$/ }).click();
    await app.getByRole('navigation').getByRole('button', { name: 'Desktop App' }).click();
    const article = app.getByRole('region');
    await expect(article.getByRole('heading', { level: 2, name: 'Desktop App' })).toBeVisible();
    const download = article.getByRole('link', { name: 'Download the API Circle desktop app' });
    await expect(download).toHaveAttribute('href', 'https://apicircle.dev/download');
    await expect(download).toHaveAttribute('target', '_blank');
    // Nothing in the article sends anyone to a GitHub release any more.
    await expect(article.locator('a[href*="github.com/apicircle/studio/releases"]')).toHaveCount(0);
    expect(await openedUrl(app, () => download.click())).toBe('https://apicircle.dev/download');
  });
});
