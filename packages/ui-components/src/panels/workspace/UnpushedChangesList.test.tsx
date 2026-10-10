import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { UnpushedChange } from '@apicircle/core';
import { UnpushedChangesList } from './UnpushedChangesList';
import { MAX_DRAWN_LINES } from './lineDiff';

function change(over: Partial<UnpushedChange>): UnpushedChange {
  return {
    bucket: 'request',
    key: 'req-0001-abcd',
    label: 'List users',
    kind: 'modified',
    base: {},
    local: {},
    ...over,
  };
}

/** Open a row and hand back its diff: the region under it, named after the entry. */
async function openDiff(label: string): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`${label}$`) }));
  return screen.getByRole('region', { name: `Change to ${label}` });
}

describe('UnpushedChangesList', () => {
  it('tells similar requests apart by method, URL and a short id', () => {
    render(
      <UnpushedChangesList
        changes={[
          change({ local: { method: 'GET', url: 'https://api/users' } }),
          // A removed request has only its old side.
          change({
            key: 'req-0002',
            kind: 'removed',
            local: undefined,
            base: { method: 'DELETE', url: 'https://api/u/1' },
          }),
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Unpushed changes' });
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('modified');
    expect(first).toHaveTextContent('GET');
    expect(first).toHaveTextContent('https://api/users');
    expect(within(first).getByTitle('Entry id: req-0001-abcd')).toHaveTextContent('req-0001');
    expect(second).toHaveTextContent('DELETE');
    expect(second).toHaveTextContent('removed');
  });

  it('shows no method or URL for other entities, odd values, or a singleton without a key', () => {
    render(
      <UnpushedChangesList
        changes={[
          change({ bucket: 'environment', key: 'env', label: 'Staging', kind: 'added' }),
          change({ key: 'req-x', local: 'not an object' }),
          change({ key: 'req-y', local: { method: 7, url: null } }),
          change({ bucket: 'tree', key: '', label: 'Collection order' }),
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('added');
    expect(items[0]).toHaveTextContent('environment');
    for (const item of items.slice(1, 3)) expect(within(item).queryByTitle(/^https/)).toBeNull();
    expect(within(items[3]).queryByTitle(/Entry id/)).toBeNull();
  });

  it('says on each row how many lines the change adds and removes, before it is opened', () => {
    render(
      <UnpushedChangesList
        changes={[
          change({ base: { name: 'Old', method: 'GET' }, local: { name: 'New', method: 'GET' } }),
          change({ key: 'new', kind: 'added', base: undefined, local: { name: 'New' } }),
          change({ key: 'gone', kind: 'removed', base: { name: 'Old' }, local: undefined }),
        ]}
      />,
    );
    const counts = screen.getAllByTitle('Lines of JSON this change adds and removes');
    expect(counts.map((count) => count.textContent)).toEqual(['+1 −1', '+3 −0', '+0 −3']);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('opens a modified row to a unified diff: the changed lines, with the lines around them', async () => {
    render(
      <UnpushedChangesList
        changes={[
          change({ base: { name: 'Old', method: 'GET' }, local: { name: 'New', method: 'GET' } }),
        ]}
      />,
    );
    const row = screen.getByRole('button', { name: 'Toggle modified List users' });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    const diff = await openDiff('List users');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    // Each line: its number on the side it is on, its marker, its text.
    const text = diff.textContent ?? '';
    expect(text).toContain('@@ -1,4 +1,4 @@');
    expect(text).toContain('1 {');
    expect(text).toContain('2−  "name": "Old",');
    expect(text).toContain('2+  "name": "New",');
    expect(text).toContain('3   "method": "GET"');
    expect(text).toContain('4 }');
    // The removed line comes before the one that replaces it.
    expect(text.indexOf('"name": "Old"')).toBeLessThan(text.indexOf('"name": "New"'));
    // A diff taller than its box is scrolled from the keyboard.
    expect(diff).toHaveAttribute('tabindex', '0');

    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('marks an added and a removed line with a tint and an edge, and leaves the rest clear', async () => {
    render(
      <UnpushedChangesList
        changes={[
          change({ base: { name: 'Old', method: 'GET' }, local: { name: 'New', method: 'GET' } }),
        ]}
      />,
    );
    const diff = await openDiff('List users');
    // A row is its line number and its code; the code is the marker and the text.
    const rowOf = (code: string): { row: HTMLElement; number: HTMLElement } => {
      const row = within(diff).getByText(code).parentElement;
      const number = row?.firstElementChild;
      if (!(row instanceof HTMLElement) || !(number instanceof HTMLElement)) {
        throw new Error(`no diff row for "${code}"`);
      }
      return { row, number };
    };

    const removed = rowOf('− "name": "Old",');
    expect(removed.row).toHaveClass('border-l-2', 'border-l-danger', 'bg-diff-del');
    expect(removed.number).toHaveClass('text-text-muted');
    expect(removed.number).toHaveTextContent('2');

    const added = rowOf('+ "name": "New",');
    expect(added.row).toHaveClass('border-l-2', 'border-l-success', 'bg-diff-add');
    expect(added.number).toHaveClass('text-text-muted');

    // An unchanged line has the edge's width and no colour, so its code starts
    // at the same column, and its number is the dimmer one.
    const kept = rowOf('"method": "GET"');
    expect(kept.row).toHaveClass('border-l-2', 'border-l-transparent');
    expect(kept.row.className).not.toMatch(/\bbg-/);
    expect(kept.number).toHaveClass('text-text-dim');

    // No row is marked with the tone painted thin over the page: that is the
    // tint a theme of the opposite hue cancels.
    for (const { row } of [removed, added, kept]) {
      expect(row.className).not.toMatch(/bg-(success|danger)\//);
    }
  });

  it('reads an added entry as all added lines and a removed one as all removed', async () => {
    render(
      <UnpushedChangesList
        changes={[
          change({ label: 'Fresh', kind: 'added', base: undefined, local: { name: 'New' } }),
          change({
            key: 'gone',
            label: 'Stale',
            kind: 'removed',
            base: { name: 'Old' },
            local: undefined,
          }),
        ]}
      />,
    );
    const added = (await openDiff('Fresh')).textContent ?? '';
    expect(added).toContain('@@ -0,0 +1,3 @@');
    expect(added).toContain('2+  "name": "New"');
    expect(added).not.toContain('−');

    const removed = (await openDiff('Stale')).textContent ?? '';
    expect(removed).toContain('@@ -1,3 +0,0 @@');
    expect(removed).toContain('2−  "name": "Old"');
    expect(removed).not.toContain('+  ');
  });

  it('treats a side that is null as one that does not exist', async () => {
    // The release ledger is `null` until the first publish: that publish adds it.
    render(
      <UnpushedChangesList
        changes={[
          change({
            bucket: 'releaseSelf',
            key: '',
            label: 'Release ledger',
            kind: 'added',
            base: null,
            local: { latest: '1.0.0' },
          }),
        ]}
      />,
    );
    const text = (await openDiff('Release ledger')).textContent ?? '';
    expect(text).toContain('@@ -0,0 +1,3 @@');
    expect(text).not.toContain('null');
  });

  it('says so when the two sides are the same JSON', async () => {
    render(<UnpushedChangesList changes={[change({ base: { a: 1 }, local: { a: 1 } })]} />);
    expect(screen.getByTitle('Lines of JSON this change adds and removes')).toHaveTextContent(
      '+0 −0',
    );
    expect(await openDiff('List users')).toHaveTextContent('No difference to show.');
  });

  it('draws the first lines of a very long change and counts the rest', async () => {
    // `{`, `"items": [`, one line per item, `]`, `}`.
    const withLines = (total: number) => ({ items: Array.from({ length: total - 4 }, () => 0) });
    render(
      <UnpushedChangesList
        changes={[
          change({
            label: 'Long',
            kind: 'added',
            base: undefined,
            local: withLines(MAX_DRAWN_LINES + 204),
          }),
          change({
            key: 'one-over',
            label: 'One over',
            kind: 'added',
            base: undefined,
            local: withLines(MAX_DRAWN_LINES + 1),
          }),
        ]}
      />,
    );
    const long = await openDiff('Long');
    expect(long).toHaveTextContent('204 more lines not shown.');
    // The last line drawn is numbered with the limit; the one after it is not there.
    expect(long.textContent).toContain(`${MAX_DRAWN_LINES}+    0`);
    expect(long.textContent).not.toContain(`${MAX_DRAWN_LINES + 1}+`);
    expect(await openDiff('One over')).toHaveTextContent('1 more line not shown.');
  });
});
