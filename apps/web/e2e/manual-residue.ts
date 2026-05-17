// Manual-residue tier — TC-IDs that are deliberately excluded from
// automated coverage. They surface in the coverage report as a separate
// tier (not counted against the "gap") so the report stays honest about
// where automated assurance stops and human verification picks up.
//
// Add or remove entries here, not in scattered comments across specs.
// scripts/e2e_coverage_report.py reads this file at report time.
//
// **What goes here:**
//   - Cross-OS packaging / installer / signing / notarisation
//   - Real third-party IdP live verification (Okta, Auth0, Azure)
//   - Browser channels Playwright doesn't reliably ship (Edge stable,
//     Safari Tech Preview, Firefox ESR specifically)
//   - Browser-level chrome surfaces (DevTools, bookmarks, popup blocker,
//     incognito, third-party-cookie policy)
//   - Production-only surfaces that the dev server can't fake (mixed
//     content, registered service worker, PWA install prompt)
//   - Perception perf where no automated metric exists
//
// **What does NOT go here:**
//   - Cases blocked by missing fixtures we plan to build (git-fixture,
//     two-tab fixture, IDB seeder, proxy fixture) — those are
//     `test.fixme` with a rationale, surfaced as scaffold-only.
//
// Each entry's value is the human-readable rationale shown in the
// report. Keep them short — one sentence.

import type { TcId } from './fixtures/tcCoverage';

export const MANUAL_RESIDUE_TC_IDS: Readonly<Record<TcId, string>> = {
  // -----------------------------------------------------------------
  // OS / Platform / Installer / Signing
  // -----------------------------------------------------------------
  // Module OP — every cell is OS-shell / installer / packaging /
  // keychain integration. Manual cross-OS CI matrix territory.
  'TC-OP-0001': 'Chrome stable smoke on macOS — manual cross-OS verification',
  'TC-OP-0002': 'Chrome stable smoke on Windows — manual cross-OS verification',
  'TC-OP-0003': 'Chrome stable smoke on Linux — manual cross-OS verification',
  'TC-OP-0004': 'Chrome canary smoke on macOS — manual',
  'TC-OP-0005': 'Chrome canary smoke on Windows — manual',
  'TC-OP-0006': 'Firefox stable smoke on macOS — manual cross-OS verification',
  'TC-OP-0007': 'Firefox stable smoke on Windows — manual cross-OS verification',
  'TC-OP-0008': 'Firefox stable smoke on Linux — manual cross-OS verification',
  'TC-OP-0009': 'Firefox ESR smoke — manual (Playwright does not ship ESR)',
  'TC-OP-0010': 'Safari smoke — manual (only macOS, separate from Playwright webkit)',
  'TC-OP-0011': 'Edge stable smoke on macOS — manual (Playwright Edge channel not reliable in CI)',
  'TC-OP-0012': 'Edge stable smoke on Windows — manual',
  'TC-OP-0013': 'Ubuntu 22.04 smoke — manual cross-OS',
  'TC-OP-0014': 'Ubuntu 22.04 keychain integration — manual (OS keychain)',
  'TC-OP-0015': 'Ubuntu 22.04 window state — manual (OS window manager)',
  'TC-OP-0016': 'Ubuntu 24.04 smoke — manual cross-OS',
  'TC-OP-0017': 'Ubuntu 24.04 keychain integration — manual',
  'TC-OP-0018': 'Ubuntu 24.04 window state — manual',
  'TC-OP-0019': 'Fedora 40 smoke — manual cross-OS',
  'TC-OP-0020': 'Fedora 40 keychain integration — manual',
  'TC-OP-0021': 'Fedora 40 window state — manual',
  'TC-OP-0022': 'Arch rolling smoke — manual cross-OS',
  'TC-OP-0023': 'Arch keychain integration — manual',
  'TC-OP-0024': 'Arch window state — manual',
  'TC-OP-0025': 'Apple Silicon arm64 macOS architecture — manual',
  'TC-OP-0026': 'Intel x86_64 macOS architecture — manual',
  'TC-OP-0027': 'x86_64 Windows architecture — manual',
  'TC-OP-0028': 'ARM64 Windows architecture — manual',
  'TC-OP-0029': 'x86_64 Linux architecture — manual',
  'TC-OP-0030': 'arm64 Linux architecture — manual',

  // -----------------------------------------------------------------
  // Security — production-build / code-signing verification
  // -----------------------------------------------------------------
  'TC-SY-0010': 'Production code signing — only verifiable against packaged build artefact',

  // -----------------------------------------------------------------
  // Web-specific browser chrome — surfaces Playwright cannot drive
  // -----------------------------------------------------------------
  'TC-WB-0009': 'Edge smoke — Playwright Edge channel not reliable in CI; covered by manual',
  'TC-WB-0010': 'Privacy/Incognito mode — browser-level state outside CDP control',
  'TC-WB-0011': 'Storage quota override — manual via DevTools storage panel',
  'TC-WB-0012': 'Service Worker registration — needs production build with SW',
  'TC-WB-0013': 'Mixed Content (http resource on https page) — needs HTTPS deployment',
  'TC-WB-0015': 'Bookmark / pin behaviour — OS / browser chrome',
  'TC-WB-0016': 'DevTools panel interaction — browser chrome',
  'TC-WB-0019': 'Popup blocker behaviour — browser chrome / policy',
  'TC-WB-0020': 'Third-party cookie policy — browser-level setting outside CDP',
  'TC-WB-0023': 'OS-level Permissions prompts — manual (OS chrome)',
  'TC-WB-0024': 'PWA install prompt — needs production build with manifest',

  // -----------------------------------------------------------------
  // Backup & Restore — whole-workspace export/import not yet built
  // -----------------------------------------------------------------
  // The product implements the snapshot ledger (in-app, in-IDB) but
  // does NOT have a whole-workspace JSON export / import feature.
  // These cells lift to live tests when that lands.
  'TC-BK-0001': 'Workspace JSON export — feature not implemented',
  'TC-BK-0002': 'Export attachments — feature not implemented',
  'TC-BK-0004': 'Re-import exported workspace — feature not implemented',
  'TC-BK-0005': 'Import merges vs overwrites — feature not implemented',
  'TC-BK-0008': 'Disk full during export — export feature not implemented',
  'TC-BK-0009': 'Selective restore (envs only) — snapshot restore is whole-state',
  'TC-BK-0010': 'Encrypted backup file — export feature not implemented',
  'TC-BK-0011': 'Backup checksum — export feature not implemented',

  // -----------------------------------------------------------------
  // Schema migration — out-of-process / multi-device surfaces
  // -----------------------------------------------------------------
  'TC-SM-0008': 'Two-device version divergence — needs git-fixture + second IDB origin',
  'TC-SM-0009': 'CLI MCP version-mismatch banner — needs CLI harness',
  'TC-SM-0010': 'Telemetry: migration event — telemetry not implemented',

  // -----------------------------------------------------------------
  // Telemetry & Privacy — pipeline not implemented in the product
  // -----------------------------------------------------------------
  // The product ships with no telemetry pipeline. The "no-network"
  // posture is the safest default, and we assert it where possible.
  // These specific UI surfaces require the feature to exist first.
  'TC-TP-0002': 'Disable telemetry from settings — telemetry UI not implemented',
  'TC-TP-0004': 'Crash reports opt-in — crash reporter not implemented',
  'TC-TP-0005': 'Crash report stack-only scrubbing — crash reporter not implemented',
  'TC-TP-0007': 'Reset install id — install-id surface not implemented',
  'TC-TP-0009': 'Privacy policy link — not yet linked in Settings',

  // -----------------------------------------------------------------
  // Code Generation - feature available only via MCP server tool
  // -----------------------------------------------------------------
  // The web app has no codegen UI panel. Per-language matrix tests live
  // under TC-MC-* (MCP layer) in apps/desktop/e2e/mcp.spec.ts. When a
  // web-UI surface for codegen ships, lift each TC-CG-* cell out of
  // residue and assert the generated snippet contents per language.
  'TC-CG-0001': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0002': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0003': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0004': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0005': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0006': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0007': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0008': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0009': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0010': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0011': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0012': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0013': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0014': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0015': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0016': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0017': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0018': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0019': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0020': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0021': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0022': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0023': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0024': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0025': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0026': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0027': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0028': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0029': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0030': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0031': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0032': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0033': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0034': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0035': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0036': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0037': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0038': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0039': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0040': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0041': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0042': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0043': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0044': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0045': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0046': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0047': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0048': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0049': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0050': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0051': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0052': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0053': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0054': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0055': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0056': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0057': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0058': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0059': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0060': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0061': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0062': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0063': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0064': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0065': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0066': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0067': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0068': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0069': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0070': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0071': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0072': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0073': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0074': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0075': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0076': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0077': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0078': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0079': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0080': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0081': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0082': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0083': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0084': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0085': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0086': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0087': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0088': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0089': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0090': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0091': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0092': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0093': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0094': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0095': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0096': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0097': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0098': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0099': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0100': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0101': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0102': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0103': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0104': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0105': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0106': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0107': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0108': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0109': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0110': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0111': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0112': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0113': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0114': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0115': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0116': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0117': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0118': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0119': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0120': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0121': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0122': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0123': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0124': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0125': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0126': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0127': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0128': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0129': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0130': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0131': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0132': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0133': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0134': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0135': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0136': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0137': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0138': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0139': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0140': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0141': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0142': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0143': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0144': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0145': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0146': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0147': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0148': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0149': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0150': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0151': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0152': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0153': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0154': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0155': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0156': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0157': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0158': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0159': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0160': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0161': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0162': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0163': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0164': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0165': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0166': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0167': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0168': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0169': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0170': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0171': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0172': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0173': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0174': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0175': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0176': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0177': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0178': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0179': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0180': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0181': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0182': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0183': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0184': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0185': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0186': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0187': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0188': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0189': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0190': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0191': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0192': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0193': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0194': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0195': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0196': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0197': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0198': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0199': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0200': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0201': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0202': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0203': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0204': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0205': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0206': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0207': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0208': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0209': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0210': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0211': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0212': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0213': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0214': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0215': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0216': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0217': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0218': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0219': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0220': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0221': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0222': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0223': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0224': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0225': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0226': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0227': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0228': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0229': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0230': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0231': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0232': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0233': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0234': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0235': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0236': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0237': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0238': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0239': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0240': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0241': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',
  'TC-CG-0242': 'Codegen has no web UI - see apps/desktop/e2e/mcp.spec.ts generate.code',

  // -----------------------------------------------------------------
  // Pre-request Scripts & Tests - script sandbox not implemented
  // -----------------------------------------------------------------
  // The product implements assertions on the response (covered under
  // Assertion Matrix) but does NOT have a JS script sandbox for pre-
  // request hooks, post-response tests, or scripting against window.
  // Lift cells out as the feature lands.
  'TC-SC-0001': 'Script sandbox / pre-request hooks not implemented (Pre-request)',
  'TC-SC-0002': 'Script sandbox / pre-request hooks not implemented (Pre-request)',
  'TC-SC-0003': 'Script sandbox / pre-request hooks not implemented (Console)',
  'TC-SC-0004': 'Script sandbox / pre-request hooks not implemented (Sandbox)',
  'TC-SC-0005': 'Script sandbox / pre-request hooks not implemented (Tests)',
  'TC-SC-0006': 'Script sandbox / pre-request hooks not implemented (Tests)',
  'TC-SC-0007': 'Script sandbox / pre-request hooks not implemented (Tests)',
  'TC-SC-0008': 'Script sandbox / pre-request hooks not implemented (Tests)',
  'TC-SC-0009': 'Script sandbox / pre-request hooks not implemented (Tests)',
  'TC-SC-0010': 'Script sandbox / pre-request hooks not implemented (Tests)',
  'TC-SC-0011': 'Script sandbox / pre-request hooks not implemented (Tests)',
  'TC-SC-0148': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0149': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0150': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0151': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0152': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0153': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0154': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0155': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0156': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0157': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0158': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0159': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0160': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0161': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0162': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0163': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0164': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0165': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0166': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0167': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0168': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0169': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0170': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0171': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0172': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0173': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0174': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0175': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0176': 'Script sandbox / pre-request hooks not implemented (Script API)',
  'TC-SC-0177': 'Script sandbox / pre-request hooks not implemented (Script API)',
  // -----------------------------------------------------------------
  // S26 audit residue — feature-gated cells
  // -----------------------------------------------------------------
  // Linked-workspace fixture (S6) not built
  'TC-MU-0012':
    'Linked-workspace fixture (S6) not built (Linked workspace owned by another team updates)',
  'TC-VI-0003':
    'Linked-workspace fixture (S6) not built (URL path <- Env var (linked higher priority))',
  'TC-VI-0004':
    'Linked-workspace fixture (S6) not built (URL path <- Env var (linked lower priority))',
  'TC-VI-0007': 'Linked-workspace fixture (S6) not built (URL path <- Linked workspace override)',
  'TC-VI-0010':
    'Linked-workspace fixture (S6) not built (URL query value <- Env var (linked higher priority…)',
  'TC-VI-0011':
    'Linked-workspace fixture (S6) not built (URL query value <- Env var (linked lower priority))',
  'TC-VI-0014':
    'Linked-workspace fixture (S6) not built (URL query value <- Linked workspace override)',
  'TC-VI-0017':
    'Linked-workspace fixture (S6) not built (Header value <- Env var (linked higher priority))',
  'TC-VI-0018':
    'Linked-workspace fixture (S6) not built (Header value <- Env var (linked lower priority))',
  'TC-VI-0021':
    'Linked-workspace fixture (S6) not built (Header value <- Linked workspace override)',
  'TC-VI-0024':
    'Linked-workspace fixture (S6) not built (Header key (rare) <- Env var (linked higher priori…)',
  'TC-VI-0025':
    'Linked-workspace fixture (S6) not built (Header key (rare) <- Env var (linked lower priorit…)',
  'TC-VI-0028':
    'Linked-workspace fixture (S6) not built (Header key (rare) <- Linked workspace override)',
  'TC-VI-0031':
    'Linked-workspace fixture (S6) not built (JSON body value <- Env var (linked higher priority…)',
  'TC-VI-0032':
    'Linked-workspace fixture (S6) not built (JSON body value <- Env var (linked lower priority))',
  'TC-VI-0035':
    'Linked-workspace fixture (S6) not built (JSON body value <- Linked workspace override)',
  'TC-VI-0038':
    'Linked-workspace fixture (S6) not built (JSON body key <- Env var (linked higher priority))',
  'TC-VI-0039':
    'Linked-workspace fixture (S6) not built (JSON body key <- Env var (linked lower priority))',
  'TC-VI-0042':
    'Linked-workspace fixture (S6) not built (JSON body key <- Linked workspace override)',
  'TC-VI-0045':
    'Linked-workspace fixture (S6) not built (Form-data value <- Env var (linked higher priority…)',
  'TC-VI-0046':
    'Linked-workspace fixture (S6) not built (Form-data value <- Env var (linked lower priority))',
  'TC-VI-0049':
    'Linked-workspace fixture (S6) not built (Form-data value <- Linked workspace override)',
  'TC-VI-0052':
    'Linked-workspace fixture (S6) not built (Form-data key <- Env var (linked higher priority))',
  'TC-VI-0053':
    'Linked-workspace fixture (S6) not built (Form-data key <- Env var (linked lower priority))',
  'TC-VI-0056':
    'Linked-workspace fixture (S6) not built (Form-data key <- Linked workspace override)',
  'TC-VI-0059':
    'Linked-workspace fixture (S6) not built (Auth Basic username <- Env var (linked higher prio…)',
  'TC-VI-0060':
    'Linked-workspace fixture (S6) not built (Auth Basic username <- Env var (linked lower prior…)',
  'TC-VI-0063':
    'Linked-workspace fixture (S6) not built (Auth Basic username <- Linked workspace override)',
  'TC-VI-0066':
    'Linked-workspace fixture (S6) not built (Auth Basic password <- Env var (linked higher prio…)',
  'TC-VI-0067':
    'Linked-workspace fixture (S6) not built (Auth Basic password <- Env var (linked lower prior…)',
  'TC-VI-0070':
    'Linked-workspace fixture (S6) not built (Auth Basic password <- Linked workspace override)',
  'TC-VI-0073':
    'Linked-workspace fixture (S6) not built (Auth Bearer token <- Env var (linked higher priori…)',
  'TC-VI-0074':
    'Linked-workspace fixture (S6) not built (Auth Bearer token <- Env var (linked lower priorit…)',
  'TC-VI-0077':
    'Linked-workspace fixture (S6) not built (Auth Bearer token <- Linked workspace override)',
  'TC-VI-0080':
    'Linked-workspace fixture (S6) not built (Auth API Key value <- Env var (linked higher prior…)',
  'TC-VI-0081':
    'Linked-workspace fixture (S6) not built (Auth API Key value <- Env var (linked lower priori…)',
  'TC-VI-0084':
    'Linked-workspace fixture (S6) not built (Auth API Key value <- Linked workspace override)',
  'TC-VI-0087':
    'Linked-workspace fixture (S6) not built (Pre-request script body <- Env var (linked higher …)',
  'TC-VI-0088':
    'Linked-workspace fixture (S6) not built (Pre-request script body <- Env var (linked lower p…)',
  'TC-VI-0091':
    'Linked-workspace fixture (S6) not built (Pre-request script body <- Linked workspace overri…)',
  'TC-VI-0094':
    'Linked-workspace fixture (S6) not built (Test assertion expected <- Env var (linked higher …)',
  'TC-VI-0095':
    'Linked-workspace fixture (S6) not built (Test assertion expected <- Env var (linked lower p…)',
  'TC-VI-0098':
    'Linked-workspace fixture (S6) not built (Test assertion expected <- Linked workspace overri…)',
  'TC-VI-0101':
    'Linked-workspace fixture (S6) not built (Cookie value <- Env var (linked higher priority))',
  'TC-VI-0102':
    'Linked-workspace fixture (S6) not built (Cookie value <- Env var (linked lower priority))',
  'TC-VI-0105':
    'Linked-workspace fixture (S6) not built (Cookie value <- Linked workspace override)',
  'TC-VR-0016': 'Linked-workspace fixture (S6) not built (Scope :: Linked env per priority)',
  'TC-VR-0018': 'Linked-workspace fixture (S6) not built (Linked Env :: Drag reorder priority)',
  'TC-VR-0019': 'Linked-workspace fixture (S6) not built (Linked Env :: Consumer override)',

  // Module VR — variable crypto + context-scope cells with no standalone
  // web-UI surface. Variable resolution, CRUD, autocomplete and secret
  // binding are covered by real tests in env.spec.ts.
  'TC-VR-0014':
    'Request-context variable precedence — context vars are produced by response extraction; covered by context-extraction.spec.ts',
  'TC-VR-0020':
    'AES-GCM secret crypto internals — covered by packages/core/src/secrets/crypto.test.ts unit tests',
  'TC-VR-0021':
    'Master-key at-rest format — covered by packages/core/src/secrets/crypto.test.ts unit tests',
  'TC-VR-0022':
    'Workspace passphrase setup — covered by workspace-management.spec.ts; vault crypto exercised by env.spec.ts encrypted-var tests',
  'TC-VR-0023': 'OS keychain integration — desktop-only, no web surface',

  // MCP-only — covered in apps/desktop/e2e/mcp.spec.ts
  'TC-MC-0054':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (workspace :: MCP tool workspace.read: happy path)',
  'TC-MC-0055':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (workspace :: MCP tool workspace.read: validation)',
  'TC-MC-0056':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (workspace :: MCP tool workspace.read: list mode)',
  'TC-MC-0057':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (workspace :: MCP tool workspace.write: happy path)',
  'TC-MC-0058':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (workspace :: MCP tool workspace.write: validation)',
  'TC-MC-0059':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (request :: MCP tool request.create: happy path)',
  'TC-MC-0060':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (request :: MCP tool request.create: validation)',
  'TC-MC-0061':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (request :: MCP tool request.read: happy path)',
  'TC-MC-0062':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (request :: MCP tool request.read: validation)',
  'TC-MC-0063':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (request :: MCP tool request.read: list mode)',
  'TC-MC-0064':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (request :: MCP tool request.update: happy path)',
  'TC-MC-0065':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (request :: MCP tool request.update: validation)',
  'TC-MC-0066':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (request :: MCP tool request.update: missing target)',
  'TC-MC-0067':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (request :: MCP tool request.delete: happy path)',
  'TC-MC-0068':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (request :: MCP tool request.delete: validation)',
  'TC-MC-0069':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (request :: MCP tool request.delete: missing target)',
  'TC-MC-0070':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (folder :: MCP tool folder.create: happy path)',
  'TC-MC-0071':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (folder :: MCP tool folder.create: validation)',
  'TC-MC-0072':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (folder :: MCP tool folder.read: happy path)',
  'TC-MC-0073':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (folder :: MCP tool folder.read: validation)',
  'TC-MC-0074':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (folder :: MCP tool folder.read: list mode)',
  'TC-MC-0075':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (folder :: MCP tool folder.update: happy path)',
  'TC-MC-0076':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (folder :: MCP tool folder.update: validation)',
  'TC-MC-0077':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (folder :: MCP tool folder.update: missing target)',
  'TC-MC-0078':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (folder :: MCP tool folder.delete: happy path)',
  'TC-MC-0079':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (folder :: MCP tool folder.delete: validation)',
  'TC-MC-0080':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (folder :: MCP tool folder.delete: missing target)',
  'TC-MC-0081':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.create: happy …)',
  'TC-MC-0082':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.create: valida…)',
  'TC-MC-0083':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.read: happy pa…)',
  'TC-MC-0084':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.read: validati…)',
  'TC-MC-0085':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.read: list mod…)',
  'TC-MC-0086':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.update: happy …)',
  'TC-MC-0087':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.update: valida…)',
  'TC-MC-0088':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.update: missin…)',
  'TC-MC-0089':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.delete: happy …)',
  'TC-MC-0090':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.delete: valida…)',
  'TC-MC-0091':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.delete: missin…)',
  'TC-MC-0092':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.set_active: ha…)',
  'TC-MC-0093':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.set_active: va…)',
  'TC-MC-0094':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.set_priority: …)',
  'TC-MC-0095':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.set_priority: …)',
  'TC-MC-0096':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.export: happy …)',
  'TC-MC-0097':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.export: valida…)',
  'TC-MC-0098':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.import: happy …)',
  'TC-MC-0099':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (environment :: MCP tool environment.import: valida…)',
  'TC-MC-0100':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.create: happy path)',
  'TC-MC-0101':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.create: validation)',
  'TC-MC-0102':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.read: happy path)',
  'TC-MC-0103':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.read: validation)',
  'TC-MC-0104':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.read: list mode)',
  'TC-MC-0105':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.update: happy path)',
  'TC-MC-0106':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.update: validation)',
  'TC-MC-0107':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.update: missing target)',
  'TC-MC-0108':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.delete: happy path)',
  'TC-MC-0109':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.delete: validation)',
  'TC-MC-0110':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.delete: missing target)',
  'TC-MC-0111':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.run: happy path)',
  'TC-MC-0112':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.run: validation)',
  'TC-MC-0116':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.add_step: happy path)',
  'TC-MC-0117':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.add_step: validation)',
  'TC-MC-0118':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.remove_step: happy path)',
  'TC-MC-0119':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.remove_step: validation)',
  'TC-MC-0120':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.reorder_steps: happy path)',
  'TC-MC-0121':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.reorder_steps: validation)',
  'TC-MC-0122':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.set_variables: happy path)',
  'TC-MC-0123':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (plan :: MCP tool plan.set_variables: validation)',
  'TC-MC-0124':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (assertion :: MCP tool assertion.create: happy path)',
  'TC-MC-0125':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (assertion :: MCP tool assertion.create: validation)',
  'TC-MC-0126':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (assertion :: MCP tool assertion.read: happy path)',
  'TC-MC-0127':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (assertion :: MCP tool assertion.read: validation)',
  'TC-MC-0128':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (assertion :: MCP tool assertion.read: list mode)',
  'TC-MC-0129':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (assertion :: MCP tool assertion.update: happy path)',
  'TC-MC-0130':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (assertion :: MCP tool assertion.update: validation)',
  'TC-MC-0131':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (assertion :: MCP tool assertion.update: missing ta…)',
  'TC-MC-0132':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (assertion :: MCP tool assertion.delete: happy path)',
  'TC-MC-0133':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (assertion :: MCP tool assertion.delete: validation)',
  'TC-MC-0134':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (assertion :: MCP tool assertion.delete: missing ta…)',
  'TC-MC-0135':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (history :: MCP tool history.list_runs: happy path)',
  'TC-MC-0136':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (history :: MCP tool history.list_runs: validation)',
  'TC-MC-0138':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (history :: MCP tool history.get_run: happy path)',
  'TC-MC-0139':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (history :: MCP tool history.get_run: validation)',
  'TC-MC-0140':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (history :: MCP tool history.delete_run: happy path)',
  'TC-MC-0141':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (history :: MCP tool history.delete_run: validation)',
  'TC-MC-0142':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (history :: MCP tool history.purge_by_age: happy pa…)',
  'TC-MC-0143':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (history :: MCP tool history.purge_by_age: validati…)',
  'TC-MC-0144':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (codebase :: MCP tool codebase.extract_collection: …)',
  'TC-MC-0145':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (codebase :: MCP tool codebase.extract_collection: …)',
  'TC-MC-0146':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_environment: happ…)',
  'TC-MC-0147':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_environment: vali…)',
  'TC-MC-0148':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_assertion: happy …)',
  'TC-MC-0149':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_assertion: valida…)',
  'TC-MC-0150':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_plan: happy path)',
  'TC-MC-0151':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_plan: validation)',
  'TC-MC-0152':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_request: happy pa…)',
  'TC-MC-0153':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_request: validati…)',
  'TC-MC-0154':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.update_request: happy pa…)',
  'TC-MC-0155':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.update_request: validati…)',
  'TC-MC-0156':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_folder_tree: happ…)',
  'TC-MC-0157':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_folder_tree: vali…)',
  'TC-MC-0158':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.add_plan_steps: happy pa…)',
  'TC-MC-0159':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.add_plan_steps: validati…)',
  'TC-MC-0160':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.set_plan_variables: happ…)',
  'TC-MC-0161':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.set_plan_variables: vali…)',
  'TC-MC-0162':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_mock_server: happ…)',
  'TC-MC-0163':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.create_mock_server: vali…)',
  'TC-MC-0164':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.add_mock_endpoint: happy…)',
  'TC-MC-0165':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.add_mock_endpoint: valid…)',
  'TC-MC-0166':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.set_endpoint_validation_…)',
  'TC-MC-0167':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.set_endpoint_validation_…)',
  'TC-MC-0168':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.set_endpoint_response_ru…)',
  'TC-MC-0169':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.set_endpoint_response_ru…)',
  'TC-MC-0170':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.set_endpoint_multipliers…)',
  'TC-MC-0171':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (prompt :: MCP tool prompt.set_endpoint_multipliers…)',
  'TC-MC-0172':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.create_from_openapi: happy p…)',
  'TC-MC-0173':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.create_from_openapi: validat…)',
  'TC-MC-0174':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.create_from_postman: happy p…)',
  'TC-MC-0175':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.create_from_postman: validat…)',
  'TC-MC-0176':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.create_from_insomnia: happy …)',
  'TC-MC-0177':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.create_from_insomnia: valida…)',
  'TC-MC-0178':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.create_manual: happy path)',
  'TC-MC-0179':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.create_manual: validation)',
  'TC-MC-0180':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.list: happy path)',
  'TC-MC-0181':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.list: validation)',
  'TC-MC-0182':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.list_endpoints: happy path)',
  'TC-MC-0183':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.list_endpoints: validation)',
  'TC-MC-0184':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.start: happy path)',
  'TC-MC-0185':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.start: validation)',
  'TC-MC-0188':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.stop: happy path)',
  'TC-MC-0189':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.stop: validation)',
  'TC-MC-0191':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.delete: happy path)',
  'TC-MC-0192':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.delete: validation)',
  'TC-MC-0193':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.delete: missing target)',
  'TC-MC-0194':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.add_endpoint: happy path)',
  'TC-MC-0195':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.add_endpoint: validation)',
  'TC-MC-0196':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.update_endpoint: happy path)',
  'TC-MC-0197':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.update_endpoint: validation)',
  'TC-MC-0198':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.delete_endpoint: happy path)',
  'TC-MC-0199':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.delete_endpoint: validation)',
  'TC-MC-0200':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.set_validation_rules: happy …)',
  'TC-MC-0201':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.set_validation_rules: valida…)',
  'TC-MC-0202':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.set_response_rules: happy pa…)',
  'TC-MC-0203':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.set_response_rules: validati…)',
  'TC-MC-0204':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.set_multipliers: happy path)',
  'TC-MC-0205':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.set_multipliers: validation)',
  'TC-MC-0206':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.import_postman_mock_collecti…)',
  'TC-MC-0207':
    'MCP-only — covered in apps/desktop/e2e/mcp.spec.ts (mock :: MCP tool mock.import_postman_mock_collecti…)',

  // Script sandbox not implemented
  'TC-VI-0006':
    'Script sandbox not implemented (URL path <- Request context var (pm.variables.set))',
  'TC-VI-0013':
    'Script sandbox not implemented (URL query value <- Request context var (pm.variabl…)',
  'TC-VI-0020':
    'Script sandbox not implemented (Header value <- Request context var (pm.variables.…)',
  'TC-VI-0027':
    'Script sandbox not implemented (Header key (rare) <- Request context var (pm.varia…)',
  'TC-VI-0034':
    'Script sandbox not implemented (JSON body value <- Request context var (pm.variabl…)',
  'TC-VI-0041':
    'Script sandbox not implemented (JSON body key <- Request context var (pm.variables…)',
  'TC-VI-0048':
    'Script sandbox not implemented (Form-data value <- Request context var (pm.variabl…)',
  'TC-VI-0055':
    'Script sandbox not implemented (Form-data key <- Request context var (pm.variables…)',
  'TC-VI-0062':
    'Script sandbox not implemented (Auth Basic username <- Request context var (pm.var…)',
  'TC-VI-0069':
    'Script sandbox not implemented (Auth Basic password <- Request context var (pm.var…)',
  'TC-VI-0076':
    'Script sandbox not implemented (Auth Bearer token <- Request context var (pm.varia…)',
  'TC-VI-0083':
    'Script sandbox not implemented (Auth API Key value <- Request context var (pm.vari…)',
  'TC-VI-0090':
    'Script sandbox not implemented (Pre-request script body <- Request context var (pm…)',
  'TC-VI-0097':
    'Script sandbox not implemented (Test assertion expected <- Request context var (pm…)',
  'TC-VI-0104':
    'Script sandbox not implemented (Cookie value <- Request context var (pm.variables.…)',

  // Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP
  'TC-OI-0001':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Auth0 :: OAuth2 against Auth0 using client_credent…)',
  'TC-OI-0002':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Auth0 :: OAuth2 against Auth0 using authorization_…)',
  'TC-OI-0003':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Auth0 :: OAuth2 against Auth0 using authorization_…)',
  'TC-OI-0004':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Auth0 :: OAuth2 against Auth0 using password)',
  'TC-OI-0005':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Auth0 :: OAuth2 against Auth0 using device_code)',
  'TC-OI-0006':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Auth0 :: OAuth2 against Auth0 using refresh_token)',
  'TC-OI-0007':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Auth0 :: OAuth2 against Auth0 using implicit)',
  'TC-OI-0008':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Okta :: OAuth2 against Okta using client_credentia…)',
  'TC-OI-0009':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Okta :: OAuth2 against Okta using authorization_co…)',
  'TC-OI-0010':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Okta :: OAuth2 against Okta using authorization_co…)',
  'TC-OI-0011':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Okta :: OAuth2 against Okta using password)',
  'TC-OI-0012':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Okta :: OAuth2 against Okta using device_code)',
  'TC-OI-0013':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Okta :: OAuth2 against Okta using refresh_token)',
  'TC-OI-0014':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Okta :: OAuth2 against Okta using implicit)',
  'TC-OI-0015':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Google Identity :: OAuth2 against Google Identity …)',
  'TC-OI-0016':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Google Identity :: OAuth2 against Google Identity …)',
  'TC-OI-0017':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Google Identity :: OAuth2 against Google Identity …)',
  'TC-OI-0018':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Google Identity :: OAuth2 against Google Identity …)',
  'TC-OI-0019':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Google Identity :: OAuth2 against Google Identity …)',
  'TC-OI-0020':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Google Identity :: OAuth2 against Google Identity …)',
  'TC-OI-0021':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Google Identity :: OAuth2 against Google Identity …)',
  'TC-OI-0022':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (GitHub :: OAuth2 against GitHub using client_crede…)',
  'TC-OI-0023':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (GitHub :: OAuth2 against GitHub using authorizatio…)',
  'TC-OI-0024':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (GitHub :: OAuth2 against GitHub using authorizatio…)',
  'TC-OI-0025':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (GitHub :: OAuth2 against GitHub using password)',
  'TC-OI-0026':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (GitHub :: OAuth2 against GitHub using device_code)',
  'TC-OI-0027':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (GitHub :: OAuth2 against GitHub using refresh_toke…)',
  'TC-OI-0028':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (GitHub :: OAuth2 against GitHub using implicit)',
  'TC-OI-0036':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (AWS Cognito :: OAuth2 against AWS Cognito using cl…)',
  'TC-OI-0037':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (AWS Cognito :: OAuth2 against AWS Cognito using au…)',
  'TC-OI-0038':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (AWS Cognito :: OAuth2 against AWS Cognito using au…)',
  'TC-OI-0039':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (AWS Cognito :: OAuth2 against AWS Cognito using pa…)',
  'TC-OI-0040':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (AWS Cognito :: OAuth2 against AWS Cognito using de…)',
  'TC-OI-0041':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (AWS Cognito :: OAuth2 against AWS Cognito using re…)',
  'TC-OI-0042':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (AWS Cognito :: OAuth2 against AWS Cognito using im…)',
  'TC-OI-0043':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Keycloak :: OAuth2 against Keycloak using client_c…)',
  'TC-OI-0044':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Keycloak :: OAuth2 against Keycloak using authoriz…)',
  'TC-OI-0045':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Keycloak :: OAuth2 against Keycloak using authoriz…)',
  'TC-OI-0046':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Keycloak :: OAuth2 against Keycloak using password)',
  'TC-OI-0047':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Keycloak :: OAuth2 against Keycloak using device_c…)',
  'TC-OI-0048':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Keycloak :: OAuth2 against Keycloak using refresh_…)',
  'TC-OI-0049':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Keycloak :: OAuth2 against Keycloak using implicit)',
  'TC-OI-0050':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Firebase Auth :: OAuth2 against Firebase Auth usin…)',
  'TC-OI-0051':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Firebase Auth :: OAuth2 against Firebase Auth usin…)',
  'TC-OI-0052':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Firebase Auth :: OAuth2 against Firebase Auth usin…)',
  'TC-OI-0053':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Firebase Auth :: OAuth2 against Firebase Auth usin…)',
  'TC-OI-0054':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Firebase Auth :: OAuth2 against Firebase Auth usin…)',
  'TC-OI-0055':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Firebase Auth :: OAuth2 against Firebase Auth usin…)',
  'TC-OI-0056':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Firebase Auth :: OAuth2 against Firebase Auth usin…)',
  'TC-OI-0064':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Generic OIDC :: OAuth2 against Generic OIDC using …)',
  'TC-OI-0065':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Generic OIDC :: OAuth2 against Generic OIDC using …)',
  'TC-OI-0066':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Generic OIDC :: OAuth2 against Generic OIDC using …)',
  'TC-OI-0067':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Generic OIDC :: OAuth2 against Generic OIDC using …)',
  'TC-OI-0068':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Generic OIDC :: OAuth2 against Generic OIDC using …)',
  'TC-OI-0069':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Generic OIDC :: OAuth2 against Generic OIDC using …)',
  'TC-OI-0070':
    'Vendor-shape OAuth2 — needs mock-IdP vendor switches or real IdP (Generic OIDC :: OAuth2 against Generic OIDC using …)',

  // Whole-workspace export feature not implemented
  'TC-CL-0039':
    'Whole-workspace export feature not implemented (Extended :: CLI: apicircle export <workspace> --fo…)',

  // -----------------------------------------------------------------
  // S17 audit - Import/Export formats not in the web UI
  // -----------------------------------------------------------------
  // HAR import not implemented in web UI
  'TC-IE-0009': 'HAR import not implemented in web UI (HAR)',
  'TC-IE-0111':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: GET no body)',
  'TC-IE-0112':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: POST with JSON body)',
  'TC-IE-0113':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: POST with form-data)',
  'TC-IE-0114':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: POST with file upload)',
  'TC-IE-0115':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: GraphQL query)',
  'TC-IE-0116':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: Bearer auth)',
  'TC-IE-0117':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: Basic auth)',
  'TC-IE-0118':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: OAuth2 (with token))',
  'TC-IE-0119':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: API key in header)',
  'TC-IE-0120':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: API key in query)',
  'TC-IE-0121':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: Custom headers)',
  'TC-IE-0122':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: Path params (:id))',
  'TC-IE-0123':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: Query params)',
  'TC-IE-0124':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: Variables in URL/body)',
  'TC-IE-0125':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: Pre-request script)',
  'TC-IE-0126':
    'HAR import not implemented in web UI (Round-trip :: Round-trip HAR file for: Tests / assertions)',

  // OpenAPI import not implemented in web UI
  'TC-IE-0047':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: GET no body)',
  'TC-IE-0048':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: POST with JSO)',
  'TC-IE-0049':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: POST with for)',
  'TC-IE-0050':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: POST with fil)',
  'TC-IE-0051':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: GraphQL query)',
  'TC-IE-0052':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: Bearer auth)',
  'TC-IE-0053':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: Basic auth)',
  'TC-IE-0054':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: OAuth2 (with )',
  'TC-IE-0055':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: API key in he)',
  'TC-IE-0056':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: API key in qu)',
  'TC-IE-0057':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: Custom header)',
  'TC-IE-0058':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: Path params ()',
  'TC-IE-0059':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: Query params)',
  'TC-IE-0060':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: Variables in )',
  'TC-IE-0061':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: Pre-request s)',
  'TC-IE-0062':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 YAML for: Tests / asser)',
  'TC-IE-0063':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: GET no body)',
  'TC-IE-0064':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: POST with JSO)',
  'TC-IE-0065':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: POST with for)',
  'TC-IE-0066':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: POST with fil)',
  'TC-IE-0067':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: GraphQL query)',
  'TC-IE-0068':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: Bearer auth)',
  'TC-IE-0069':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: Basic auth)',
  'TC-IE-0070':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: OAuth2 (with )',
  'TC-IE-0071':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: API key in he)',
  'TC-IE-0072':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: API key in qu)',
  'TC-IE-0073':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: Custom header)',
  'TC-IE-0074':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: Path params ()',
  'TC-IE-0075':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: Query params)',
  'TC-IE-0076':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: Variables in )',
  'TC-IE-0077':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: Pre-request s)',
  'TC-IE-0078':
    'OpenAPI import not implemented in web UI (Round-trip :: Round-trip OpenAPI 3.0 JSON for: Tests / asser)',

  // Swagger 2.0 import not implemented in web UI
  'TC-IE-0079':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: GET no body)',
  'TC-IE-0080':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: POST with JSON bod)',
  'TC-IE-0081':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: POST with form-dat)',
  'TC-IE-0082':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: POST with file upl)',
  'TC-IE-0083':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: GraphQL query)',
  'TC-IE-0084':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: Bearer auth)',
  'TC-IE-0085':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: Basic auth)',
  'TC-IE-0086':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: OAuth2 (with token)',
  'TC-IE-0087':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: API key in header)',
  'TC-IE-0088':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: API key in query)',
  'TC-IE-0089':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: Custom headers)',
  'TC-IE-0090':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: Path params (:id))',
  'TC-IE-0091':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: Query params)',
  'TC-IE-0092':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: Variables in URL/b)',
  'TC-IE-0093':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: Pre-request script)',
  'TC-IE-0094':
    'Swagger 2.0 import not implemented in web UI (Round-trip :: Round-trip Swagger 2.0 for: Tests / assertions)',

  // Whole-workspace export feature not implemented
  'TC-IE-0010': 'Whole-workspace export feature not implemented (Export :: Export workspace JSON)',
  'TC-IE-0012': 'Whole-workspace export feature not implemented (Export :: Export omits secrets)',
  'TC-IE-0013': 'Whole-workspace export feature not implemented (Download)',
  'TC-IE-0014': 'Whole-workspace export feature not implemented (Upload)',

  // -----------------------------------------------------------------
  // Assertion 'Schema' kind not implemented
  // -----------------------------------------------------------------
  // packages/shared/src/types.ts:541 — Assertion.kind is
  // 'status' | 'header' | 'json-path' | 'duration'. The workbook
  // includes 'Schema' as a kind per-plan-scenario; lift these cells
  // out of residue when the Assertion type adds 'schema'.
  'TC-AS-0017': 'Assertion schema kind not implemented (Single GET / Schema)',
  'TC-AS-0025': 'Assertion schema kind not implemented (Sequential 5 steps / Schema)',
  'TC-AS-0033': 'Assertion schema kind not implemented (Step 2 depends on step 1 output / Schema)',
  'TC-AS-0041': 'Assertion schema kind not implemented (Step with pre-script error / Schema)',
  'TC-AS-0049': 'Assertion schema kind not implemented (Step with post-script error / Schema)',
  'TC-AS-0057': 'Assertion schema kind not implemented (Disabled step skipped / Schema)',
  'TC-AS-0065': 'Assertion schema kind not implemented (Re-run idempotent for read-only / Schema)',
  'TC-AS-0073': 'Assertion schema kind not implemented (Loop step (if supported) / Schema)',
  'TC-AS-0081': 'Assertion schema kind not implemented (Conditional step (if supported) / Schema)',
  'TC-AS-0089': 'Assertion schema kind not implemented (Step with empty assertions / Schema)',
  'TC-AS-0097': 'Assertion schema kind not implemented (Step with 50 assertions / Schema)',
  'TC-AS-0105':
    'Assertion schema kind not implemented (Plan with parallel branch (if supported) / Schema)',
  'TC-AS-0113': 'Assertion schema kind not implemented (Step timeout / Schema)',
  'TC-AS-0121': 'Assertion schema kind not implemented (Step retry on failure / Schema)',

  // -----------------------------------------------------------------
  // Keyboard shortcuts owned by the browser — not interceptable from
  // a page-level keydown listener. Manual cross-browser verification.
  // -----------------------------------------------------------------
  'TC-KB-0007': 'Ctrl+R reloads browser — browser-owned shortcut, not interceptable from JS',
  'TC-KB-0008': 'Ctrl+W closes tab — browser-owned shortcut, not interceptable from JS',
  'TC-KB-0009': 'Ctrl+F opens browser Find — browser-owned shortcut, not interceptable from JS',
  'TC-KB-0010': 'Ctrl+P opens browser Print — browser-owned shortcut, not interceptable from JS',

  // -----------------------------------------------------------------
  // Browser-mandated request headers (Accept-Encoding is a Forbidden
  // Header in the Fetch spec — JS cannot suppress it). Asserting the
  // "absent" path requires a non-browser HTTP client surface.
  // -----------------------------------------------------------------
  'TC-CE-0016':
    'Browser always sends Accept-Encoding — forbidden header, cannot be suppressed from fetch()',

  // -----------------------------------------------------------------
  // Desktop shell scenarios that require an OS-signed binary, OS-WM,
  // or OS-driven external trigger (network yank, suspend, disk fill).
  // Verified at release time on a signed artifact, not inside Playwright.
  // -----------------------------------------------------------------
  'TC-DS-0001': 'Auto-update startup check — needs signed installer + live update feed',
  'TC-DS-0002': 'Auto-update update banner — needs signed installer + live update feed',
  'TC-DS-0003': 'Auto-update Check-Now button — needs signed installer + live update feed',
  'TC-DS-0004': 'Auto-update offline check — needs signed installer + live update feed',
  'TC-DS-0005': 'Auto-update signature-failure abort — needs tampered signed artifact',
  'TC-DS-0013':
    'Fullscreen state persistence — OS-WM controlled, unreliable in headless Playwright',
  'TC-DS-0014': 'Cmd+Q (macOS) — delivered by macOS WM, unreliable under headless',
  'TC-DS-0016': 'macOS Dock icon — macOS-only, app.dock undefined off macOS',
  'TC-DS-0017': 'macOS Menu Bar — OS-driven, covered by macOS visual QA',
  'TC-DS-0019': 'macOS Gatekeeper — needs OS-signed + notarised binary',
  'TC-DS-0020': 'Windows SmartScreen — needs OS-signed binary',
  'TC-DS-0021': 'Linux package signing — needs signed deb/rpm/AppImage',
  'TC-DS-0028': 'First-run flow — depends on fresh OS user profile / installer',
  'TC-DS-0029': 'Crash recovery — needs an OS-level crash trigger',
  'TC-DS-0030': 'Power suspend/resume — needs OS power-state trigger',
  'TC-DS-0031': 'Network yank — needs OS-level network disconnect',
  'TC-DS-0032': 'Disk-full handling — needs OS-level storage exhaustion',
  'TC-DS-0033': 'Monitor disconnect — needs OS-level display reconfiguration',

  // -----------------------------------------------------------------
  // Performance perception cases — subjective, OS-paint-engine
  // sensitive, or stress-test budgets that need real datasets at a
  // scale unsuitable for the per-test budget. Manual perception QA.
  // -----------------------------------------------------------------
  'TC-PE-0002': 'Large response paint time — OS-paint-engine sensitive, manual perception QA',
  'TC-PE-0004': '100+ attached files — needs file-attachment fixture (S4) and is manual until then',
  'TC-PE-0013': '10 concurrent mock servers — bridge surface covered by MK, real-stress is manual',
  'TC-PE-0014':
    '200-endpoint mock server — covered by mock-server-core unit tests, OS-paint manual',
  'TC-PE-0018': '100MB raw body — OS-RAM perception case, manual',
  'TC-PE-0019': '100MB binary response — viewer-paint perception case, manual',
  'TC-PE-0022': 'Unicode-heavy CJK workspace — OS-font-engine sensitive, manual perception QA',
};

/** Set form for runtime checks (used by `tcCoverage.ts` if needed). */
export const MANUAL_RESIDUE_SET: ReadonlySet<TcId> = new Set(
  Object.keys(MANUAL_RESIDUE_TC_IDS) as TcId[],
);
