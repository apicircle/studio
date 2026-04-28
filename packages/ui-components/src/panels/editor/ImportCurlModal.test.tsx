import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ImportCurlModal } from './ImportCurlModal';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

describe('ImportCurlModal', () => {
  beforeEach(hydrate);

  it('renders nothing when closed', () => {
    render(<ImportCurlModal open={false} onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the textarea + Import disabled when empty', () => {
    render(<ImportCurlModal open onClose={() => undefined} />);
    expect(screen.getByLabelText('cURL command')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('Paste sample fills the textarea with a valid cURL', async () => {
    render(<ImportCurlModal open onClose={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: /Paste sample/ }));
    const textarea = screen.getByLabelText('cURL command') as HTMLTextAreaElement;
    expect(textarea.value).toContain('curl');
    expect(textarea.value).toContain('Authorization');
  });

  it('shows a live preview of method/URL/body once text is entered', async () => {
    render(<ImportCurlModal open onClose={() => undefined} />);
    const textarea = screen.getByLabelText('cURL command');
    await userEvent.click(textarea);
    await userEvent.paste(`curl -X POST https://api.test/x --json '{"a":1}'`);
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('https://api.test/x')).toBeInTheDocument();
    expect(screen.getByText('json')).toBeInTheDocument();
  });

  it('Import creates a new request with the parsed values and calls onClose', async () => {
    const onClose = vi.fn();
    render(<ImportCurlModal open onClose={onClose} />);
    const textarea = screen.getByLabelText('cURL command');
    await userEvent.click(textarea);
    await userEvent.paste(
      `curl -X POST https://api.test/users -H 'X-Foo: Bar' --json '{"name":"alice"}'`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onClose).toHaveBeenCalledOnce();

    const synced = useWorkspaceStore.getState().synced!;
    const requests = Object.values(synced.collections.requests);
    expect(requests).toHaveLength(1);
    const r = requests[0];
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://api.test/users');
    expect(r.headers).toContainEqual({ key: 'X-Foo', value: 'Bar', enabled: true });
    expect(r.body).toEqual({ type: 'json', content: '{"name":"alice"}' });
    expect(r.name).toBe('POST /users');
  });

  it('Cancel closes the modal without creating a request', async () => {
    const onClose = vi.fn();
    render(<ImportCurlModal open onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('cURL command'));
    await userEvent.paste(`curl https://api.test/x`);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    const requests = Object.values(useWorkspaceStore.getState().synced!.collections.requests);
    expect(requests).toHaveLength(0);
  });

  it('shows warnings from the parser', async () => {
    render(<ImportCurlModal open onClose={() => undefined} />);
    await userEvent.click(screen.getByLabelText('cURL command'));
    await userEvent.paste(`curl --magic-flag https://api.test/x`);
    // The warning row prefixes with ⚠ — scope to that prefix so we don't
    // collide with the raw cURL still showing in the textarea.
    expect(screen.getByText(/⚠.*--magic-flag/)).toBeInTheDocument();
  });

  it('disables Import when the parsed URL is empty', async () => {
    render(<ImportCurlModal open onClose={() => undefined} />);
    await userEvent.click(screen.getByLabelText('cURL command'));
    await userEvent.paste(`curl -X POST -H 'A: 1'`);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
});
