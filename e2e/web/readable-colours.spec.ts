import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

// Focus and tone colours draw in each theme's readable colours, in EVERY
// theme. apps/web's theme-contrast test measures the tokens (`headerParts`,
// `LENS_LINK`, `ringShortfalls`, `fieldParts`); this proves the built CSS
// paints exactly those tokens:
//   - the keyboard focus ring of the Lens link, the Help button, a panel tab and
//     a request section tab (the `Tabs` primitive) is the accent's readable
//     colour (`--accent-fg`), not 70% of the accent;
//   - the active panel tab's label is `--accent-fg` too, not the bare accent;
//   - a field's focus edge and ring are `--accent-fg`, not the bare accent and
//     a 30% ring of it;
//   - a native checkbox's focus outline (global.css `*:focus-visible`) and its
//     ticked fill (`accent-color`) are `--accent-fg`, not the bare accent.

/** Every theme the built CSS defines, read from its `[data-theme]` rules. */
async function themeIds(app: Page): Promise<string[]> {
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
  return themes;
}

/** Turn transitions off: a colour change eases in, and we measure where it lands. */
async function stillColours(app: Page): Promise<void> {
  await app.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
}

/** The controls whose ring is a box-shadow, by what a reader calls them. */
const RINGED = {
  'the Lens link': '[data-lens-link]',
  'the Help button': '[data-tour="nav-help"]',
  'an idle tab': 'nav[aria-label="Top navigation"] button:not([aria-current])',
  'the active tab': 'nav[aria-label="Top navigation"] [aria-current="page"]',
  'a request section tab': '[role="tablist"] [role="tab"][aria-selected="true"]',
};

/** A field with a focus edge and ring, a field with an edge alone, and a native checkbox. */
const FIELDS = {
  'a key field': 'input[type="checkbox"][aria-label^="Enable"] + input',
  'the request search': 'input[placeholder="Search requests…"]',
  'a row checkbox': 'input[type="checkbox"][aria-label^="Enable"]',
};

test.describe('Readable colours in every theme', () => {
  test('focus rings and the active tab label use the readable accent in every theme', async ({
    app,
  }) => {
    // 60 themes, each read in one round trip; generous for a loaded runner.
    test.setTimeout(90_000);
    await stillColours(app);
    for (const selector of Object.values(RINGED)) {
      await expect(app.locator(selector).first()).toBeVisible();
    }
    const themes = await themeIds(app);

    // A key press puts the page in keyboard mode: from here on, focusing a
    // control shows the ring a keyboard user sees (`:focus-visible`).
    await app.keyboard.press('Shift');

    const off: string[] = [];
    for (const theme of themes) {
      const seen = await app.evaluate(
        ({ id, controls }) => {
          document.documentElement.setAttribute('data-theme', id);
          const channels = getComputedStyle(document.documentElement)
            .getPropertyValue('--accent-fg')
            .trim()
            .split(/\s+/)
            .join(', ');
          const accentFg = `rgb(${channels})`;
          const lines: string[] = [];
          const active = document.querySelector(controls['the active tab']) as HTMLElement;
          const label = getComputedStyle(active).color;
          if (label !== accentFg) lines.push(`the active tab's label is ${label}`);
          for (const [what, selector] of Object.entries(controls)) {
            const el = document.querySelector(selector) as HTMLElement;
            el.focus();
            const shadow = getComputedStyle(el).boxShadow;
            if (!el.matches(':focus-visible')) lines.push(`${what} shows no keyboard focus`);
            else if (!shadow.includes(accentFg)) lines.push(`${what}'s focus ring is ${shadow}`);
          }
          return lines;
        },
        { id: theme, controls: RINGED },
      );
      off.push(...seen.map((line) => `${theme}: ${line}`));
    }
    expect(off).toEqual([]);
  });

  test('a field and a checkbox show focus in the readable accent in every theme', async ({
    app,
  }) => {
    test.setTimeout(90_000);
    await stillColours(app);
    for (const selector of Object.values(FIELDS)) {
      await expect(app.locator(selector).first()).toBeVisible();
    }
    const themes = await themeIds(app);
    await app.keyboard.press('Shift');

    const off: string[] = [];
    for (const theme of themes) {
      const seen = await app.evaluate(
        ({ id, fields }) => {
          document.documentElement.setAttribute('data-theme', id);
          const channels = getComputedStyle(document.documentElement)
            .getPropertyValue('--accent-fg')
            .trim()
            .split(/\s+/)
            .join(', ');
          const accentFg = `rgb(${channels})`;
          const lines: string[] = [];
          const focused = (selector: string) => {
            const el = document.querySelector(selector) as HTMLElement;
            el.focus();
            return getComputedStyle(el);
          };

          // A field: its edge, and its ring where it has one, turn the readable accent.
          const key = focused(fields['a key field']);
          if (key.borderTopColor !== accentFg)
            lines.push(`a key field's edge is ${key.borderTopColor}`);
          if (!key.boxShadow.includes(accentFg))
            lines.push(`a key field's ring is ${key.boxShadow}`);
          const search = focused(fields['the request search']);
          if (search.borderTopColor !== accentFg) {
            lines.push(`the request search's edge is ${search.borderTopColor}`);
          }

          // A native checkbox draws no ring of its own: the app's default outline.
          const box = document.querySelector(fields['a row checkbox']) as HTMLElement;
          box.focus();
          const outline = getComputedStyle(box);
          if (!box.matches(':focus-visible')) lines.push('a row checkbox shows no keyboard focus');
          else if (outline.outlineColor !== accentFg || outline.outlineStyle !== 'solid') {
            lines.push(
              `a row checkbox's outline is ${outline.outlineStyle} ${outline.outlineColor}`,
            );
          }
          // Ticked, it is filled with its accent-color: the readable accent too.
          if (outline.accentColor !== accentFg) {
            lines.push(`a row checkbox's ticked fill is ${outline.accentColor}`);
          }
          return lines;
        },
        { id: theme, fields: FIELDS },
      );
      off.push(...seen.map((line) => `${theme}: ${line}`));
    }
    expect(off).toEqual([]);
  });
});
