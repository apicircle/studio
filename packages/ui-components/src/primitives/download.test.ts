import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile } from './download';

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

/** jsdom's Blob has no `text()`; FileReader reads it. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result as string);
    reader.readAsText(blob);
  });
}

afterEach(() => {
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
});

describe('downloadTextFile', () => {
  it('clicks a link to a blob of the contents, named as asked, then releases it', async () => {
    const create = vi.fn<(blob: Blob) => string>(() => 'blob:fake');
    const revoke = vi.fn();
    URL.createObjectURL = create as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revoke;
    const clicked: Array<{ download: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.getAttribute('href') ?? '' });
    });

    expect(downloadTextFile('users.json', '{"id":1}', 'application/json')).toBe(true);
    expect(clicked).toEqual([{ download: 'users.json', href: 'blob:fake' }]);
    // The link is gone, and the blob is released only once the click has started.
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(revoke).toHaveBeenCalledWith('blob:fake');
    const blob = create.mock.calls[0][0];
    expect(blob.type).toBe('application/json');
    expect(await readBlob(blob)).toBe('{"id":1}');
  });

  it('defaults to plain text', () => {
    const create = vi.fn<(blob: Blob) => string>(() => 'blob:fake');
    URL.createObjectURL = create as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadTextFile('notes.txt', 'hi');
    expect(create.mock.calls[0][0].type).toBe('text/plain');
  });

  it('does nothing, and says so, where the page cannot start a download', () => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = undefined;
    expect(downloadTextFile('a.txt', 'x')).toBe(false);
  });
});
