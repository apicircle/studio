/**
 * The API Circle mark, as geometry in a 100×100 view box: a violet hub with a
 * "send" chevron, and six services on a ring round it, each joined to the hub
 * by a spoke. `AppIcon` draws it still and `BrandLoader` draws it in motion, so
 * both read off this one description and cannot drift apart.
 */

export const MARK_CENTER = 50;
export const MARK_RING_RADIUS = 38;
export const MARK_NODE_RADIUS = 6;
export const MARK_CORE_RADIUS = 18;
export const MARK_GLOW_RADIUS = 27;
/** The hub's solid fill. The white chevron sits on it, so it never takes a theme tone. */
export const MARK_CORE_FILL = '#8b5cf6';
export const MARK_GLOW_FILL = '#a78bfa';
export const MARK_CHEVRON = 'M44 41 L56 50 L44 59';
/** The green "live" pip at the chevron's tip. */
export const MARK_PIP = { cx: 61, cy: 50, r: 2.4, fill: '#22c55e' } as const;

const SPOKE_INNER = MARK_CORE_RADIUS + 3;
const SPOKE_OUTER = MARK_RING_RADIUS - MARK_NODE_RADIUS - 2;

/**
 * The six services, clockwise from the top: the logo's own colour, and the
 * theme token the loader dresses the node in so it reads on every theme.
 */
export const MARK_NODES = [
  { angle: 90, color: '#a78bfa', tone: 'purple' },
  { angle: 30, color: '#22c55e', tone: 'green' },
  { angle: -30, color: '#3b82f6', tone: 'blue' },
  { angle: -90, color: '#f59e0b', tone: 'amber' },
  { angle: -150, color: '#ef4444', tone: 'red' },
  { angle: 150, color: '#60a5fa', tone: 'info' },
] as const;

/** A point `radius` out from the hub at `angleDeg` (0° = 3 o'clock, counter-clockwise, y down). */
export function markPoint(angleDeg: number, radius: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [MARK_CENTER + radius * Math.cos(rad), MARK_CENTER - radius * Math.sin(rad)];
}

/** A spoke's hub-side end, then its node-side end: `[x1, y1, x2, y2]`. */
export function markSpoke(angleDeg: number): [number, number, number, number] {
  const [x1, y1] = markPoint(angleDeg, SPOKE_INNER);
  const [x2, y2] = markPoint(angleDeg, SPOKE_OUTER);
  return [x1, y1, x2, y2];
}

/** `#a78bfa` → `167 139 250`, the space-separated triplet the theme tokens use. */
export function hexToRgbTriplet(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
