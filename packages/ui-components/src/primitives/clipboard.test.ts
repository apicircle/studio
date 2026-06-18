import { describe, expect, it, vi } from 'vitest';
import { safeCopyToClipboard } from './clipboard';

describe('safeCopyToClipboard', () => {
  it('returns ok:true when navigator.clipboard.writeText succeeds', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const result = await safeCopyToClipboard('hello');
    expect(result).toEqual({ ok: true });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
  });

  it('falls through to execCommand fallback when writeText rejects', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    // jsdom doesn't implement execCommand, so the fallback also fails —
    // but the important behavior is that we TRY the fallback rather than
    // returning the writeText error directly.
    const result = await safeCopyToClipboard('hello');
    expect(result).toEqual({ ok: false, reason: 'Clipboard API unavailable' });
  });

  it('returns ok:false when clipboard API is absent and fallback fails', async () => {
    Object.assign(navigator, { clipboard: undefined });
    // jsdom doesn't implement execCommand — the fallback textarea path
    // catches the exception and returns false, yielding the unavailable reason.
    const result = await safeCopyToClipboard('hello');
    expect(result).toEqual({ ok: false, reason: 'Clipboard API unavailable' });
  });
});
