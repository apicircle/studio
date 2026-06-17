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

  it('returns ok:false with reason when writeText rejects', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const result = await safeCopyToClipboard('hello');
    expect(result).toEqual({ ok: false, reason: 'denied' });
  });

  it('returns ok:false when clipboard API is absent and fallback fails', async () => {
    Object.assign(navigator, { clipboard: undefined });
    // jsdom doesn't implement execCommand — the fallback textarea path
    // catches the exception and returns false, yielding the unavailable reason.
    const result = await safeCopyToClipboard('hello');
    expect(result).toEqual({ ok: false, reason: 'Clipboard API unavailable' });
  });
});
