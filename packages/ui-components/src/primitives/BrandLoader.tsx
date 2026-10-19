import { useInsertionEffect } from 'react';
import { cn } from './cn';
import {
  MARK_CENTER,
  MARK_CHEVRON,
  MARK_CORE_FILL,
  MARK_CORE_RADIUS,
  MARK_GLOW_FILL,
  MARK_GLOW_RADIUS,
  MARK_NODE_RADIUS,
  MARK_NODES,
  MARK_PIP,
  MARK_RING_RADIUS,
  hexToRgbTriplet,
  markPoint,
  markSpoke,
} from './brandMark';

/**
 * The API Circle mark, set in motion: the one loader every wait in Studio shows.
 *
 * The mark is a hub — the violet core with its "send" chevron — and six
 * services on a ring round it, each joined to the core by a spoke. Waiting
 * reads as the hub calling round the circle: a pulse leaves the core along one
 * spoke, its node lights, and the next one clockwise follows, while the dashed
 * orbit turns slowly behind. So the boot screen, a panel that is reading a
 * repository and a button that is sending a request all show the same shape,
 * and the shape is the brand rather than a generic spinner.
 *
 * Two drawings, one rhythm:
 *   - `full` (24px and up) — the whole mark: orbit, spokes, node rings, core
 *     and chevron.
 *   - `compact` (under 24px, inside buttons and status lines) — the ring of six
 *     dots round the core, which is what is still legible at 14–16px.
 *
 * The nodes take the theme's own purple/green/blue/amber/red/info, so the mark
 * stays visible on every theme (each tunes those against its surfaces); the
 * core keeps the brand violet because the white chevron sits on it. Under
 * `prefers-reduced-motion` nothing moves or scales — the nodes only brighten in
 * turn, which still says "working".
 *
 * Always decorative (`aria-hidden`): the words beside it — a button's
 * "Sending…", a {@link LoadingState} title — are what assistive tech announces.
 */

export type BrandLoaderSize = 'xs' | 'sm' | 'md' | 'lg';

export interface BrandLoaderProps {
  /** `xs` 14px · `sm` 16px (inline) · `md` 40px · `lg` 64px (a panel or page waiting) — or pixels. */
  size?: BrandLoaderSize | number;
  className?: string;
}

const PIXELS: Record<BrandLoaderSize, number> = { xs: 14, sm: 16, md: 40, lg: 64 };

/** Below this the spokes and chevron blur together, so the compact drawing is used. */
const COMPACT_BELOW = 24;

/** The compact ring sits a little inside the full one so its larger dots keep a gap between them. */
const COMPACT_RADIUS = 36;
const COMPACT_DOT_RADIUS = 10;
const COMPACT_CORE_RADIUS = 13;

export const BRAND_LOADER_STYLE_ID = 'apicircle-brand-loader';

// One cycle visits all six nodes, 300ms apart. Each node's delay is negative so
// the ring is already mid-sweep on first paint rather than starting dark.
const CYCLE_S = 1.8;
const STEP_S = CYCLE_S / MARK_NODES.length;

// The fallbacks are the logo's own colours, for a host that has not loaded the
// theme tokens.
const TONE_CSS = MARK_NODES.map(
  ({ tone, color }) =>
    `.apc-loader .apc-t-${tone}{color:rgb(var(--${tone},${hexToRgbTriplet(color)}))}`,
).join('');

const DELAY_CSS = MARK_NODES.map(
  (_, i) => `.apc-loader .apc-d${i}{animation-delay:${(i * STEP_S - CYCLE_S).toFixed(2)}s}`,
).join('');

/**
 * The loader's stylesheet. Byte for byte the one API Circle Lens draws its own
 * copy of the mark with, so the two can share a page: whichever mounts first
 * puts the sheet in, under the same id, and the other finds it there.
 */
export const BRAND_LOADER_CSS =
  `.apc-loader{display:inline-block;flex-shrink:0;vertical-align:middle;overflow:visible}` +
  `.apc-loader .apc-node{opacity:.32;transform-box:fill-box;transform-origin:center;` +
  `animation:apc-node ${CYCLE_S}s cubic-bezier(.4,0,.2,1) infinite both}` +
  `.apc-loader .apc-spoke{opacity:.18;animation:apc-spoke ${CYCLE_S}s ease-out infinite both}` +
  `.apc-loader .apc-orbit{transform-box:view-box;transform-origin:50% 50%;animation:apc-orbit 12s linear infinite}` +
  `.apc-loader .apc-core{transform-box:fill-box;transform-origin:center;animation:apc-core ${CYCLE_S}s ease-in-out infinite}` +
  `.apc-loader .apc-halo{animation:apc-halo ${CYCLE_S}s ease-in-out infinite}` +
  `.apc-loader .apc-live{animation:apc-live ${CYCLE_S / 2}s ease-in-out infinite alternate}` +
  TONE_CSS +
  DELAY_CSS +
  // The pulse reaches the spoke first, then lights the node: a call going out to it.
  `@keyframes apc-spoke{0%{opacity:.18}8%{opacity:1}34%,100%{opacity:.18}}` +
  `@keyframes apc-node{0%,100%{opacity:.32;transform:scale(.84)}16%{opacity:1;transform:scale(1.14)}44%{opacity:.32;transform:scale(.84)}}` +
  `@keyframes apc-node-fade{0%,100%{opacity:.32}16%{opacity:1}44%{opacity:.32}}` +
  `@keyframes apc-orbit{to{transform:rotate(360deg)}}` +
  `@keyframes apc-core{0%,100%{transform:scale(.94)}50%{transform:scale(1)}}` +
  `@keyframes apc-halo{0%,100%{opacity:.12}50%{opacity:.32}}` +
  `@keyframes apc-live{from{opacity:1}to{opacity:.25}}` +
  `@media (prefers-reduced-motion:reduce){` +
  `.apc-loader .apc-orbit,.apc-loader .apc-core,.apc-loader .apc-spoke{animation:none}` +
  `.apc-loader .apc-node{animation-name:apc-node-fade;transform:none}}`;

/**
 * Put the loader's stylesheet in the document once. The component brings its
 * own rather than adding keyframes to the apps' global stylesheet, which every
 * edition that embeds Studio keeps a guarded copy of; the apps' CSP already
 * allows inline styles.
 */
function useLoaderStyles() {
  useInsertionEffect(() => {
    if (document.getElementById(BRAND_LOADER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = BRAND_LOADER_STYLE_ID;
    style.textContent = BRAND_LOADER_CSS;
    document.head.appendChild(style);
  }, []);
}

export function BrandLoader({ size = 'sm', className }: BrandLoaderProps) {
  useLoaderStyles();
  const px = typeof size === 'number' ? size : PIXELS[size];
  const compact = px < COMPACT_BELOW;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-brand-loader={compact ? 'compact' : 'full'}
      viewBox="0 0 100 100"
      width={px}
      height={px}
      fill="none"
      className={cn('apc-loader', className)}
    >
      {compact ? <CompactMark /> : <FullMark />}
    </svg>
  );
}

function CompactMark() {
  return (
    <>
      {MARK_NODES.map(({ angle, tone }, i) => {
        const [cx, cy] = markPoint(angle, COMPACT_RADIUS);
        return (
          <circle
            key={tone}
            className={`apc-node apc-d${i} apc-t-${tone}`}
            cx={cx}
            cy={cy}
            r={COMPACT_DOT_RADIUS}
            fill="currentColor"
          />
        );
      })}
      <circle
        className="apc-core"
        cx={MARK_CENTER}
        cy={MARK_CENTER}
        r={COMPACT_CORE_RADIUS}
        fill={MARK_CORE_FILL}
      />
    </>
  );
}

function FullMark() {
  return (
    <>
      <g className="apc-orbit">
        <circle
          cx={MARK_CENTER}
          cy={MARK_CENTER}
          r={MARK_RING_RADIUS}
          stroke="rgb(var(--text-faint, 148 163 184))"
          strokeOpacity={0.55}
          strokeWidth={1.25}
          strokeDasharray="2 3"
        />
      </g>
      {MARK_NODES.map(({ angle, tone }, i) => {
        const [x1, y1, x2, y2] = markSpoke(angle);
        return (
          <line
            key={tone}
            className={`apc-spoke apc-d${i} apc-t-${tone}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}
      {MARK_NODES.map(({ angle, tone }, i) => {
        const [cx, cy] = markPoint(angle, MARK_RING_RADIUS);
        return (
          <circle
            key={tone}
            className={`apc-node apc-d${i} apc-t-${tone}`}
            cx={cx}
            cy={cy}
            r={MARK_NODE_RADIUS}
            stroke="currentColor"
            strokeWidth={3}
          />
        );
      })}
      <circle
        className="apc-halo"
        cx={MARK_CENTER}
        cy={MARK_CENTER}
        r={MARK_GLOW_RADIUS}
        fill={MARK_GLOW_FILL}
        opacity={0.2}
      />
      <g className="apc-core">
        <circle cx={MARK_CENTER} cy={MARK_CENTER} r={MARK_CORE_RADIUS} fill={MARK_CORE_FILL} />
        <path
          d={MARK_CHEVRON}
          stroke="#fff"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          className="apc-live"
          cx={MARK_PIP.cx}
          cy={MARK_PIP.cy}
          r={MARK_PIP.r}
          fill={MARK_PIP.fill}
        />
      </g>
    </>
  );
}

export interface LoadingStateProps {
  /** What is being waited for, as a sentence: "Loading workspace…". */
  title: string;
  /** Optional second line: what happens next, or why it can take a while. */
  detail?: string;
  /**
   * `sm` — one line, the compact mark beside the title, where a status line
   * sits inside a form or a list. `md` for a section, `lg` for a whole panel
   * or page: the full mark above the title, centred in the space the content
   * will take.
   */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * A wait the user is looking at: the mark beside or above a title and an
 * optional detail line. It is a polite live region, so the title is announced
 * once when the wait starts.
 */
export function LoadingState({ title, detail, size = 'md', className }: LoadingStateProps) {
  if (size === 'sm') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn('flex items-center gap-1.5 text-[0.6875rem] text-text-dim', className)}
      >
        <BrandLoader size="xs" />
        <span>{title}</span>
        {detail ? <span className="text-text-faint">{detail}</span> : null}
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-4 py-8 text-center',
        className,
      )}
    >
      <BrandLoader size={size} />
      <div className="max-w-sm">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        {detail ? <p className="mt-1 text-xs text-text-dim">{detail}</p> : null}
      </div>
    </div>
  );
}
