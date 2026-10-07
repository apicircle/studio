import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui-components/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: 'rgb(var(--surface) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        'border-subtle': 'rgb(var(--border-subtle) / <alpha-value>)',
        'text-primary': 'rgb(var(--text-primary) / <alpha-value>)',
        'text-muted': 'rgb(var(--text-muted) / <alpha-value>)',
        'text-dim': 'rgb(var(--text-dim) / <alpha-value>)',
        'text-faint': 'rgb(var(--text-faint) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-strong': 'rgb(var(--accent-strong) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        // Readable-on-its-own-tint foregrounds, generated per theme by
        // scripts/gen-status-fg.mjs. Use `text-<tone>-fg` for tone-coloured text;
        // the bare tone stays for borders, fills and icons.
        'accent-fg': 'rgb(var(--accent-fg) / <alpha-value>)',
        'success-fg': 'rgb(var(--success-fg) / <alpha-value>)',
        'warning-fg': 'rgb(var(--warning-fg) / <alpha-value>)',
        'danger-fg': 'rgb(var(--danger-fg) / <alpha-value>)',
        'info-fg': 'rgb(var(--info-fg) / <alpha-value>)',
        purple: 'rgb(var(--purple) / <alpha-value>)',
        blue: 'rgb(var(--blue) / <alpha-value>)',
        green: 'rgb(var(--green) / <alpha-value>)',
        amber: 'rgb(var(--amber) / <alpha-value>)',
        red: 'rgb(var(--red) / <alpha-value>)',
        'http-get': 'rgb(var(--http-get) / <alpha-value>)',
        'http-post': 'rgb(var(--http-post) / <alpha-value>)',
        'http-put': 'rgb(var(--http-put) / <alpha-value>)',
        'http-patch': 'rgb(var(--http-patch) / <alpha-value>)',
        'http-delete': 'rgb(var(--http-delete) / <alpha-value>)',
        'http-head': 'rgb(var(--http-head) / <alpha-value>)',
        'http-options': 'rgb(var(--http-options) / <alpha-value>)',
      },
      fontFamily: {
        // `--app-font` is set by the FontPicker on boot. The fallback chain
        // mirrors `system-mono` (the default preset) so the UI stays
        // readable even when the variable is unset (SSR, first paint).
        mono: [
          'var(--app-font, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace)',
        ],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
      },
      boxShadow: {
        elevated: '0 18px 48px rgba(0, 0, 0, 0.24)',
      },
    },
  },
  plugins: [],
};

export default config;
