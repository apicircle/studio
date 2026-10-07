import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { UnpushedChange } from '@apicircle/core';
import { UnpushedChangesList } from './UnpushedChangesList';

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

  it('expands a row to its before and after, saying when a side did not exist', async () => {
    render(
      <UnpushedChangesList
        changes={[
          change({ kind: 'added', base: undefined, local: { name: 'New' } }),
          change({ key: 'gone', kind: 'removed', base: { name: 'Old' }, local: undefined }),
        ]}
      />,
    );
    const [added, removed] = screen.getAllByRole('button');
    expect(added).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(added);
    expect(added).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('— (did not exist)')).toBeInTheDocument();
    expect(screen.getByText(/"name": "New"/)).toBeInTheDocument();
    await userEvent.click(removed);
    expect(screen.getByText('— (deleted)')).toBeInTheDocument();
    await userEvent.click(added);
    expect(added).toHaveAttribute('aria-expanded', 'false');
  });
});
