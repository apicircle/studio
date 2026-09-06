import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UIEvent } from 'react';
import { useLazyListWindow } from './useLazyListWindow';

// The repo browsers rendered a hard `slice(0, 50)`: the fifty-first repo was
// unreachable and nothing on screen said so. This window keeps the whole list
// in memory and pages only what is rendered.

const ITEMS = Array.from({ length: 120 }, (_, i) => `repo-${i}`);

/** A scroll event over a container of the given geometry. */
function scrolled(scrollTop: number, clientHeight: number, scrollHeight: number) {
  return {
    currentTarget: { scrollTop, clientHeight, scrollHeight },
  } as unknown as UIEvent<HTMLElement>;
}

describe('useLazyListWindow', () => {
  it('opens at one page and reports that more exists', () => {
    const { result } = renderHook(() => useLazyListWindow(ITEMS));
    expect(result.current.visible).toHaveLength(50);
    expect(result.current.visible[0]).toBe('repo-0');
    expect(result.current.hasMore).toBe(true);
  });

  it('grows by a page on showMore, and stops reporting more at the end', () => {
    const { result } = renderHook(() => useLazyListWindow(ITEMS));
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(100);
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(120);
    expect(result.current.hasMore).toBe(false);
  });

  it('grows only when the container is scrolled near its bottom', () => {
    const { result } = renderHook(() => useLazyListWindow(ITEMS));
    // 100px down a 2000px list in a 256px viewport — nowhere near the bottom.
    act(() => result.current.onScroll(scrolled(100, 256, 2000)));
    expect(result.current.visible).toHaveLength(50);
    // Within the near-bottom threshold.
    act(() => result.current.onScroll(scrolled(1720, 256, 2000)));
    expect(result.current.visible).toHaveLength(100);
  });

  it('ignores scrolling once everything is rendered', () => {
    const { result } = renderHook(() => useLazyListWindow(ITEMS.slice(0, 10)));
    expect(result.current.hasMore).toBe(false);
    act(() => result.current.onScroll(scrolled(1000, 256, 300)));
    expect(result.current.visible).toHaveLength(10);
  });

  it('resets to one page when the list changes identity', () => {
    // A new filter or a new host is a new array; a window sized for the old one
    // would render more than asked, or hide the new results behind it.
    const { result, rerender } = renderHook(({ items }) => useLazyListWindow(items), {
      initialProps: { items: ITEMS },
    });
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(100);

    const filtered = ITEMS.filter((r) => r.startsWith('repo-1'));
    rerender({ items: filtered });
    expect(result.current.visible).toHaveLength(31);
    expect(result.current.hasMore).toBe(false);

    rerender({ items: ITEMS });
    expect(result.current.visible).toHaveLength(50);
    expect(result.current.hasMore).toBe(true);
  });

  it('honours a custom page size', () => {
    const { result } = renderHook(() => useLazyListWindow(ITEMS, 25));
    expect(result.current.visible).toHaveLength(25);
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(50);
  });
});
