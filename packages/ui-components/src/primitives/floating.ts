import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react';

// The anchored floating layer: where tooltips and menus get their position.
//
// Why a portal: a popover positioned `absolute` inside its trigger's box is
// clipped by every ancestor with `overflow: hidden | auto` — a scrolling
// sidebar, a resizable panel, the panel `<main>` — and no z-index escapes a
// clip. Rendering into `document.body` with `position: fixed` takes it out of
// all of them. Theming survives the move because the theme variables live on
// `<html>` (see `theme/applyTheme.ts`).
//
// Why measured: once it is out of the anchor's box, the popover is placed from
// the anchor's viewport rect, and that is also where it is kept on screen —
// it flips to the other side when the preferred one has no room, and slides
// along the anchor so it never hangs off an edge.

export type FloatingSide = 'top' | 'bottom' | 'left' | 'right';
export type FloatingAlign = 'start' | 'center' | 'end';

export interface FloatingRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export interface AnchoredPositionInput {
  anchor: FloatingRect;
  floating: FloatingSize;
  viewport: FloatingSize;
  side: FloatingSide;
  align: FloatingAlign;
  /** Gap between the anchor and the floating element, in px. */
  offset?: number;
  /** Distance kept from every viewport edge, in px. */
  padding?: number;
  /** Move to the opposite side when the preferred one has no room. */
  flip?: boolean;
  /**
   * Size the floating element along the main axis to the room on the side it
   * opens to (a long menu then scrolls inside instead of being pushed over its
   * trigger). The caller applies {@link AnchoredPosition.room} as its max size.
   */
  capToRoom?: boolean;
}

export interface AnchoredPosition {
  top: number;
  left: number;
  /** The side actually used: the preferred one unless it flipped. */
  side: FloatingSide;
  align: FloatingAlign;
  /**
   * Room on the used side along the main axis — height for top/bottom, width
   * for left/right. `null` when the anchor has no box to measure from.
   */
  room: number | null;
}

const OPPOSITE: Record<FloatingSide, FloatingSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/** Clamp into `[min, max]`; something larger than the room pins to `min`. */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function isVertical(side: FloatingSide): boolean {
  return side === 'top' || side === 'bottom';
}

/** Where along the anchor's cross axis the floating element starts. */
function alongAnchor(start: number, length: number, size: number, align: FloatingAlign): number {
  if (align === 'start') return start;
  if (align === 'end') return start + length - size;
  return start + (length - size) / 2;
}

/**
 * Place a floating element next to its anchor, inside the viewport. Pure: the
 * hook below feeds it measured rects, and tests feed it numbers.
 */
export function computeAnchoredPosition({
  anchor,
  floating,
  viewport,
  side,
  align,
  offset = 4,
  padding = 8,
  flip = true,
  capToRoom = false,
}: AnchoredPositionInput): AnchoredPosition {
  // An anchor with no box (display:none, or a DOM without layout) gives
  // nothing to measure from — keep the requested placement rather than
  // inventing one from zeros.
  if (anchor.width === 0 && anchor.height === 0) {
    return { top: anchor.top, left: anchor.left, side, align, room: null };
  }

  const roomOn = (s: FloatingSide): number => {
    if (s === 'top') return anchor.top - offset - padding;
    if (s === 'bottom') return viewport.height - (anchor.top + anchor.height) - offset - padding;
    if (s === 'left') return anchor.left - offset - padding;
    return viewport.width - (anchor.left + anchor.width) - offset - padding;
  };

  const vertical = isVertical(side);
  const need = vertical ? floating.height : floating.width;
  let used = side;
  if (flip && roomOn(side) < need && roomOn(OPPOSITE[side]) > roomOn(side)) used = OPPOSITE[side];

  const room = Math.max(0, roomOn(used));
  const mainSize = capToRoom ? Math.min(need, room) : need;

  if (vertical) {
    const rawTop =
      used === 'top' ? anchor.top - offset - mainSize : anchor.top + anchor.height + offset;
    const rawLeft = alongAnchor(anchor.left, anchor.width, floating.width, align);
    return {
      top: clamp(rawTop, padding, viewport.height - padding - mainSize),
      left: clamp(rawLeft, padding, viewport.width - padding - floating.width),
      side: used,
      align,
      room,
    };
  }
  const rawLeft =
    used === 'left' ? anchor.left - offset - mainSize : anchor.left + anchor.width + offset;
  const rawTop = alongAnchor(anchor.top, anchor.height, floating.height, align);
  return {
    top: clamp(rawTop, padding, viewport.height - padding - floating.height),
    left: clamp(rawLeft, padding, viewport.width - padding - mainSize),
    side: used,
    align,
    room,
  };
}

export interface UseAnchoredPositionOptions {
  /** Measure and track only while open. */
  open: boolean;
  side?: FloatingSide;
  align?: FloatingAlign;
  offset?: number;
  padding?: number;
  flip?: boolean;
  /** See {@link AnchoredPositionInput.capToRoom}; the room becomes the max size. */
  capToRoom?: boolean;
  /** Size from the anchor's width: `min` = at least as wide, `exact` = as wide. */
  matchAnchorWidth?: 'min' | 'exact';
  /**
   * The tallest the floating element may be, in px. Use it instead of a
   * `max-h-*` class, so placement measures the height it will really have.
   */
  maxHeight?: number;
}

export interface AnchoredPositionState {
  /** Spread onto the floating element. Always `position: fixed`. */
  style: CSSProperties;
  /** Resolved side and alignment — exposed as `data-side` / `data-align`. */
  side: FloatingSide;
  align: FloatingAlign;
  /** The anchor left the document or scrolled out of the viewport. */
  anchorHidden: boolean;
}

/** Where a floating element waits while it is closed: off screen, out of the way. */
const CLOSED_STYLE: CSSProperties = { position: 'fixed', top: -10000, left: -10000 };

interface Measured {
  pos: AnchoredPosition;
  anchorWidth: number;
  hidden: boolean;
}

function sameMeasure(a: Measured | null, b: Measured): boolean {
  return (
    a !== null &&
    a.pos.top === b.pos.top &&
    a.pos.left === b.pos.left &&
    a.pos.side === b.pos.side &&
    a.pos.align === b.pos.align &&
    a.pos.room === b.pos.room &&
    a.anchorWidth === b.anchorWidth &&
    a.hidden === b.hidden
  );
}

/**
 * Track the position of `floatingRef` next to `anchorRef` while `open`:
 * measured before paint, then again on any scroll (in any ancestor), resize,
 * or size change of either element — one measurement per animation frame.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  {
    open,
    side = 'bottom',
    align = 'start',
    offset = 4,
    padding = 8,
    flip = true,
    capToRoom = false,
    matchAnchorWidth,
    maxHeight,
  }: UseAnchoredPositionOptions,
): AnchoredPositionState {
  const [measured, setMeasured] = useState<Measured | null>(null);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    const rect = anchor.getBoundingClientRect();
    const viewport = {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
    };
    const ownWidth = floating.offsetWidth;
    const width =
      matchAnchorWidth === 'exact'
        ? rect.width
        : matchAnchorWidth === 'min'
          ? Math.max(ownWidth, rect.width)
          : ownWidth;
    // scrollHeight is the natural height even while a previous measurement
    // capped it, so a menu that now has room grows back.
    const natural = Math.max(floating.offsetHeight, floating.scrollHeight);
    const height = maxHeight === undefined ? natural : Math.min(natural, maxHeight);
    const pos = computeAnchoredPosition({
      anchor: rect,
      floating: { width, height },
      viewport,
      side,
      align,
      offset,
      padding,
      flip,
      capToRoom,
    });
    const hasBox = rect.width > 0 || rect.height > 0;
    const hidden =
      !anchor.isConnected ||
      (hasBox &&
        (rect.bottom < 0 ||
          rect.top > viewport.height ||
          rect.right < 0 ||
          rect.left > viewport.width));
    const next: Measured = { pos, anchorWidth: rect.width, hidden };
    setMeasured((prev) => (sameMeasure(prev, next) ? prev : next));
  }, [
    anchorRef,
    floatingRef,
    side,
    align,
    offset,
    padding,
    flip,
    capToRoom,
    matchAnchorWidth,
    maxHeight,
  ]);

  // Before paint, so an opening popover never shows a frame at its old spot.
  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const schedule = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    // Capture: a scroll inside any ancestor moves the anchor too.
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    if (floatingRef.current) observer?.observe(floatingRef.current);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [open, measure, anchorRef, floatingRef]);

  if (!open || measured === null) {
    return { style: CLOSED_STYLE, side, align, anchorHidden: false };
  }
  const { pos } = measured;
  const style: CSSProperties = { position: 'fixed', top: pos.top, left: pos.left };
  let tallest = maxHeight;
  if (capToRoom && pos.room !== null) {
    if (isVertical(pos.side))
      tallest = tallest === undefined ? pos.room : Math.min(tallest, pos.room);
    else style.maxWidth = pos.room;
  }
  if (tallest !== undefined) style.maxHeight = tallest;
  if (matchAnchorWidth === 'min') style.minWidth = measured.anchorWidth;
  else if (matchAnchorWidth === 'exact') style.width = measured.anchorWidth;
  return { style, side: pos.side, align: pos.align, anchorHidden: measured.hidden };
}

/**
 * Stacking for the floating layer. A menu opens above a modal (`z-50`) — a
 * menu inside a dialog must not sit under its overlay — and below toasts
 * (`z-[60]`); a tooltip sits above everything.
 */
export const FLOATING_Z = {
  menu: 'z-[55]',
  tooltip: 'z-[70]',
} as const;

/**
 * Close a popover on a pointer press outside it — where "inside" is the React
 * subtree, not the DOM subtree. A portalled list is not a DOM descendant of
 * the popover that opened it, so a DOM `contains` check reads a press on one
 * of its options as outside and closes the parent before the click lands.
 *
 * Spread the returned props on the element that wraps the trigger and the
 * portal in the React tree: React delivers a portalled child's events through
 * its React ancestors, so the press is marked inside before it reaches the
 * window listener, which then lets it pass.
 */
export function useDismissableLayer({
  open,
  onDismiss,
}: {
  open: boolean;
  onDismiss: () => void;
}): { onPointerDownCapture: (e: ReactPointerEvent) => void } {
  const insideEvent = useRef<Event | null>(null);
  const onDismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (insideEvent.current === e) return;
      onDismissRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onPointerDownCapture = useCallback((e: ReactPointerEvent) => {
    insideEvent.current = e.nativeEvent;
  }, []);
  return { onPointerDownCapture };
}
