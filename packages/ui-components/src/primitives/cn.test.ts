import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('concatenates truthy strings with spaces', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });
  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
  it('returns empty string when all values are falsy', () => {
    expect(cn(false, null, undefined)).toBe('');
  });

  describe('conflict resolution', () => {
    it('lets a later height override an earlier one', () => {
      expect(cn('h-9 px-3', 'h-7')).toBe('px-3 h-7');
    });
    it('lets a call-site className override a primitive base', () => {
      const base = 'inline-flex h-8 items-center rounded-sm px-3 text-xs';
      expect(cn(base, 'h-7 px-2')).toBe('inline-flex items-center rounded-sm text-xs h-7 px-2');
    });
    it('keeps font size and text colour, which are different groups', () => {
      expect(cn('text-xs', 'text-accent')).toBe('text-xs text-accent');
    });
    it('resolves competing font sizes', () => {
      expect(cn('text-xs', 'text-sm')).toBe('text-sm');
    });
    it('treats an arbitrary font size as a font size', () => {
      expect(cn('text-sm', 'text-[0.6875rem]')).toBe('text-[0.6875rem]');
    });
    it('keeps non-conflicting utilities untouched', () => {
      expect(cn('flex items-center gap-2', 'rounded-sm border')).toBe(
        'flex items-center gap-2 rounded-sm border',
      );
    });
    it('preserves responsive and state variants separately from the base', () => {
      expect(cn('grid-cols-1', 'sm:grid-cols-2')).toBe('grid-cols-1 sm:grid-cols-2');
    });
    it('resolves conflicts within the same variant', () => {
      expect(cn('hover:bg-card', 'hover:bg-surface')).toBe('hover:bg-surface');
    });
  });
});
