import { describe, expect, it } from 'vitest';
import { mockSpecWarningToast } from './mockSpecWarnings';

describe('mockSpecWarningToast', () => {
  it('says nothing when the spec parsed cleanly into endpoints', () => {
    expect(mockSpecWarningToast('Petstore', 12, [])).toBeNull();
  });

  it('reports a partly-read spec as information, not failure', () => {
    const toast = mockSpecWarningToast('Petstore', 12, ['ref a', 'ref b']);
    expect(toast?.tone).toBe('info');
    expect(toast?.title).toContain('Petstore');
    expect(toast?.detail).toBe('ref a · ref b');
  });

  it('treats an empty endpoint table as a failure and carries the reason', () => {
    const toast = mockSpecWarningToast('Petstore', 0, ['the path item for /pets is a $ref']);
    expect(toast?.tone).toBe('error');
    expect(toast?.title).toContain('serves no endpoints');
    expect(toast?.detail).toBe('the path item for /pets is a $ref');
  });

  it('explains an empty endpoint table the parser had no complaint about', () => {
    const toast = mockSpecWarningToast('Petstore', 0, []);
    expect(toast?.tone).toBe('error');
    expect(toast?.detail).toContain('no operations');
  });
});
