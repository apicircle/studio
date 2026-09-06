import { useState } from 'react';
import type { UIEvent } from 'react';

/** How close to the bottom, in px, a list must be scrolled before the next page renders. */
const NEAR_BOTTOM_PX = 32;

export interface LazyListWindow<T> {
  /** The items to render right now — the first `limit` of `items`. */
  visible: T[];
  /** Whether `items` holds more than `visible` shows. */
  hasMore: boolean;
  /** Attach to the scrolling container; reveals the next page near its bottom. */
  onScroll: (event: UIEvent<HTMLElement>) => void;
  /** Reveal the next page without scrolling — the keyboard and assistive path. */
  showMore: () => void;
}

/**
 * A render window over an in-memory list that grows as the user scrolls.
 *
 * The repo browsers used to render a hard `slice(0, 50)`: the fifty-first repo
 * was unreachable, and nothing on screen said so. Rendering every entry is the
 * wrong fix — an account spanning several Bitbucket workspaces can hold
 * thousands, and a listbox that size janks on every keystroke of the filter.
 * So the list stays complete in memory (the filter sees all of it) and only
 * the DOM is paged: the window opens at `pageSize` entries and extends by
 * another page each time the container scrolls near its bottom, or when the
 * "show more" control is activated.
 *
 * The window resets whenever `items` changes identity — a new filter or a new
 * host produces a new array, and a window sized for the old one would either
 * hide the new results or render more than asked. The reset happens during
 * render, the way React documents for state derived from a prop: React re-runs
 * the render with the fresh window before anything is painted, so the old
 * window is never shown over the new list, and no effect is involved.
 */
export function useLazyListWindow<T>(items: readonly T[], pageSize = 50): LazyListWindow<T> {
  const [window, setWindow] = useState<{ items: readonly T[]; limit: number }>({
    items,
    limit: pageSize,
  });
  if (window.items !== items) setWindow({ items, limit: pageSize });
  const limit = window.items === items ? window.limit : pageSize;
  const hasMore = items.length > limit;
  const showMore = () => setWindow({ items, limit: limit + pageSize });
  const onScroll = (event: UIEvent<HTMLElement>) => {
    if (!hasMore) return;
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM_PX) showMore();
  };
  return { visible: items.slice(0, limit), hasMore, onScroll, showMore };
}
