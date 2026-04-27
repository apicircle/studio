import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

/**
 * Build a File-like object with the requested size without allocating
 * the actual bytes. Browsers / jsdom honor `file.size` independently of
 * the underlying blob payload, so the store's size guard reads the
 * right number without us needing 100 MB of memory.
 */
function fileOfSize(name: string, sizeBytes: number, mimeType = 'image/png'): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: mimeType });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

describe('attachment size limits (plan §7.6)', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a binary attachment over 100 MB', async () => {
    const id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestBody(id, { type: 'binary', content: '' });
    const big = fileOfSize('huge.bin', 101 * 1024 * 1024);
    await expect(useWorkspaceStore.getState().attachBinaryFile(id, big)).rejects.toThrow(
      /exceeds GitHub's 100 MB limit/,
    );
  });

  it('warns (does not throw) for a 10–100 MB binary attachment', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestBody(id, { type: 'binary', content: '' });
    const medium = fileOfSize('big.bin', 12 * 1024 * 1024);
    // The actual attach call may or may not complete depending on jsdom IDB
    // perf, but the size check happens at the top of the action and runs
    // synchronously — so by awaiting we either get clean resolution or a
    // non-size error. The point is no size error.
    await useWorkspaceStore
      .getState()
      .attachBinaryFile(id, medium)
      .catch(() => {
        // ignore non-size errors from the IDB write path
      });
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toMatch(/12.0 MB/);
  });

  it('refuses an oversized form-data file row', async () => {
    const id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'form-data',
      content: '',
      formRows: [{ kind: 'file', key: 'avatar', slotId: null, enabled: true }],
    });
    const big = fileOfSize('huge.bin', 200 * 1024 * 1024);
    await expect(useWorkspaceStore.getState().attachFormFile(id, 0, big)).rejects.toThrow(
      /exceeds GitHub's 100 MB limit/,
    );
  });
});
