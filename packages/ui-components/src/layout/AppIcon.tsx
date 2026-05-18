interface AppIconProps {
  size?: number;
  className?: string;
}

// Inline-SVG rendition of the launcher mark so the in-app brand chrome can
// drop the dark bezel that the .ico/.icns/favicon bundles still carry.
// Bezel-less means the glyph fills its slot at any size and inherits the
// theme background — no per-theme variant needed.
const NODES = [
  { angle: 90, color: '#a78bfa' }, // top — purple
  { angle: 30, color: '#22c55e' }, // top-right — green
  { angle: -30, color: '#3b82f6' }, // right — blue
  { angle: -90, color: '#f59e0b' }, // bottom — amber
  { angle: -150, color: '#ef4444' }, // bottom-left — red
  { angle: 150, color: '#60a5fa' }, // left — light blue
] as const;

const CENTER = 50;
const RING_RADIUS = 38;
const NODE_RADIUS = 6;
const CENTER_FILL_RADIUS = 18;
const CENTER_GLOW_RADIUS = 27;
const CONNECTOR_INNER = CENTER_FILL_RADIUS + 3;
const CONNECTOR_OUTER = RING_RADIUS - NODE_RADIUS - 2;

function polar(angleDeg: number, radius: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER - radius * Math.sin(rad)];
}

export function AppIcon({ size = 24, className }: AppIconProps) {
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
        <radialGradient id="apicircle-app-icon-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#a78bfa" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Faint orbital ring — uses currentColor so it adapts per theme. */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RING_RADIUS}
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1"
        strokeDasharray="2 3"
      />

      {/* Connector lines from center to each orbital node. */}
      <g strokeWidth="2" strokeLinecap="round">
        {NODES.map(({ angle, color }) => {
          const [x1, y1] = polar(angle, CONNECTOR_INNER);
          const [x2, y2] = polar(angle, CONNECTOR_OUTER);
          return <line key={`l-${angle}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} />;
        })}
      </g>

      {/* Orbital nodes — outlined rings. */}
      <g strokeWidth="3" fill="none">
        {NODES.map(({ angle, color }) => {
          const [cx, cy] = polar(angle, RING_RADIUS);
          return <circle key={`n-${angle}`} cx={cx} cy={cy} r={NODE_RADIUS} stroke={color} />;
        })}
      </g>

      {/* Central glow + solid + chevron + status pip. */}
      <circle cx={CENTER} cy={CENTER} r={CENTER_GLOW_RADIUS} fill="url(#apicircle-app-icon-glow)" />
      <circle cx={CENTER} cy={CENTER} r={CENTER_FILL_RADIUS} fill="#8b5cf6" />
      <path
        d="M44 41 L56 50 L44 59"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx={61} cy={50} r={2.4} fill="#22c55e" />
    </svg>
  );
}
