import { useId } from 'react';
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
  markPoint,
  markSpoke,
} from '../primitives/brandMark';

interface AppIconProps {
  size?: number;
  className?: string;
}

// Inline-SVG rendition of the launcher mark so the in-app brand chrome can
// drop the dark bezel that the .ico/.icns/favicon bundles still carry.
// Bezel-less means the glyph fills its slot at any size and inherits the
// theme background — no per-theme variant needed. The geometry is the one
// `BrandLoader` animates (primitives/brandMark.ts).
export function AppIcon({ size = 24, className }: AppIconProps) {
  // One gradient id per icon: two icons on a page with a shared hard-coded id
  // both paint from whichever <defs> came first, and lose the glow entirely
  // once that one unmounts. useId's colons are dropped to keep `url(#…)` plain.
  const glowId = `apicircle-app-icon-glow-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={MARK_GLOW_FILL} stopOpacity="0.55" />
          <stop offset="55%" stopColor={MARK_GLOW_FILL} stopOpacity="0.18" />
          <stop offset="100%" stopColor={MARK_GLOW_FILL} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Faint orbital ring — uses currentColor so it adapts per theme. */}
      <circle
        cx={MARK_CENTER}
        cy={MARK_CENTER}
        r={MARK_RING_RADIUS}
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1"
        strokeDasharray="2 3"
      />

      {/* Connector lines from center to each orbital node. */}
      <g strokeWidth="2" strokeLinecap="round">
        {MARK_NODES.map(({ angle, color }) => {
          const [x1, y1, x2, y2] = markSpoke(angle);
          return <line key={`l-${angle}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} />;
        })}
      </g>

      {/* Orbital nodes — outlined rings. */}
      <g strokeWidth="3" fill="none">
        {MARK_NODES.map(({ angle, color }) => {
          const [cx, cy] = markPoint(angle, MARK_RING_RADIUS);
          return <circle key={`n-${angle}`} cx={cx} cy={cy} r={MARK_NODE_RADIUS} stroke={color} />;
        })}
      </g>

      {/* Central glow + solid + chevron + status pip. */}
      <circle cx={MARK_CENTER} cy={MARK_CENTER} r={MARK_GLOW_RADIUS} fill={`url(#${glowId})`} />
      <circle cx={MARK_CENTER} cy={MARK_CENTER} r={MARK_CORE_RADIUS} fill={MARK_CORE_FILL} />
      <path
        d={MARK_CHEVRON}
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx={MARK_PIP.cx} cy={MARK_PIP.cy} r={MARK_PIP.r} fill={MARK_PIP.fill} />
    </svg>
  );
}
