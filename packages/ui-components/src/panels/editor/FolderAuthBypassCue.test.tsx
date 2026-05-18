import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Folder, RequestAuth } from '@apicircle/shared';
import { FolderAuthBypassCue } from './FolderAuthBypassCue';

const folder = (
  id: string,
  parentId: string | null,
  auth?: RequestAuth,
  name = `Folder ${id}`,
): Folder => ({
  id,
  parentId,
  name,
  ...(auth ? { auth } : {}),
});

describe('FolderAuthBypassCue', () => {
  it('renders when request auth is `none` and an ancestor folder has explicit auth', () => {
    const folders: Record<string, Folder> = {
      f1: folder('f1', null, { type: 'api-key', key: 'X-API-Key', value: 's', addTo: 'header' }),
    };
    render(
      <FolderAuthBypassCue
        requestAuth={{ type: 'none' }}
        folderId="f1"
        folders={folders}
        onUseFolderAuth={() => {}}
      />,
    );
    const cue = screen.getByLabelText('Folder auth bypass cue');
    expect(cue).toBeInTheDocument();
    // Text content is split across spans, so assert against the cue's
    // flattened textContent rather than a node-level regex.
    expect(cue.textContent).toMatch(/Folder\s+Folder f1/);
    expect(cue.textContent).toMatch(/API key/);
    expect(cue.textContent).toMatch(/bypassing it/);
  });

  it('hides when the request auth is `inherit` (the cue is only for explicit overrides)', () => {
    const folders: Record<string, Folder> = {
      f1: folder('f1', null, { type: 'bearer', token: 't' }),
    };
    const { container } = render(
      <FolderAuthBypassCue
        requestAuth={{ type: 'inherit' }}
        folderId="f1"
        folders={folders}
        onUseFolderAuth={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('hides when the request auth is set to a concrete type (user explicitly chose something)', () => {
    const folders: Record<string, Folder> = {
      f1: folder('f1', null, { type: 'bearer', token: 't' }),
    };
    const { container } = render(
      <FolderAuthBypassCue
        requestAuth={{ type: 'basic', username: 'u', password: 'p' }}
        folderId="f1"
        folders={folders}
        onUseFolderAuth={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('hides when no ancestor folder has explicit auth', () => {
    const folders: Record<string, Folder> = {
      f1: folder('f1', null), // no auth
      f2: folder('f2', 'f1', { type: 'inherit' }), // pass-through
    };
    const { container } = render(
      <FolderAuthBypassCue
        requestAuth={{ type: 'none' }}
        folderId="f2"
        folders={folders}
        onUseFolderAuth={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('walks the chain past `inherit` ancestors to find an explicit one', () => {
    const folders: Record<string, Folder> = {
      f1: folder('f1', null, { type: 'bearer', token: 'top-token' }, 'Top'),
      f2: folder('f2', 'f1', { type: 'inherit' }, 'Middle'),
      f3: folder('f3', 'f2', undefined, 'Leaf'),
    };
    render(
      <FolderAuthBypassCue
        requestAuth={{ type: 'none' }}
        folderId="f3"
        folders={folders}
        onUseFolderAuth={() => {}}
      />,
    );
    expect(screen.getByLabelText('Folder auth bypass cue')).toBeInTheDocument();
    // Cue surfaces the *nearest concrete* ancestor (Top) by name.
    expect(screen.getByText(/Top/)).toBeInTheDocument();
    expect(screen.getByText(/Bearer token/i)).toBeInTheDocument();
  });

  it('hides at the root (folderId=null) when there is no folder chain', () => {
    const { container } = render(
      <FolderAuthBypassCue
        requestAuth={{ type: 'none' }}
        folderId={null}
        folders={{}}
        onUseFolderAuth={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('"Use folder auth" button calls onUseFolderAuth so the parent flips request auth to inherit', async () => {
    const onUseFolderAuth = vi.fn();
    const folders: Record<string, Folder> = {
      f1: folder('f1', null, { type: 'api-key', key: 'X-API-Key', value: 's', addTo: 'header' }),
    };
    render(
      <FolderAuthBypassCue
        requestAuth={{ type: 'none' }}
        folderId="f1"
        folders={folders}
        onUseFolderAuth={onUseFolderAuth}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Use folder auth/i }));
    expect(onUseFolderAuth).toHaveBeenCalledTimes(1);
  });

  it('hides when the chain has only `none` auth values (treated as no auth)', () => {
    const folders: Record<string, Folder> = {
      f1: folder('f1', null, { type: 'none' }),
      f2: folder('f2', 'f1', { type: 'none' }),
    };
    const { container } = render(
      <FolderAuthBypassCue
        requestAuth={{ type: 'none' }}
        folderId="f2"
        folders={folders}
        onUseFolderAuth={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
