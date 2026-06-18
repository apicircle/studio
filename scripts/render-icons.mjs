// Single source of truth: apps/web/public/favicon.svg → every icon the
// desktop bundle, OS launchers, VS Code Marketplace, and dev BrowserWindow need.
//
// Outputs:
//   apps/desktop/build/icon.png            1024×1024 transparent PNG (Linux + electron-builder default)
//   apps/desktop/build/icon-transparent.png  same as icon.png (kept as a legacy alias)
//   apps/desktop/build/icon.ico            multi-resolution Windows .ico (16/24/32/48/64/128/256)
//   apps/desktop/build/icon.icns           multi-resolution macOS .icns (16/32/64/128/256/512/1024 + @2x)
//   apps/desktop/build/icons/<size>.png    per-size PNGs (16, 24, 32, 48, 64, 128, 256, 512, 1024)
//                                          consumed by BrowserWindow.icon in dev + by Linux desktop entries
//   apps/vscode/media/icon-marketplace.png 256×256 colorful brand on dark galleryBanner background
//
// Run:  pnpm icons    (re-runs on every release)

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// @playwright/test is only present in the dev tree (hoisted from the e2e
// packages that depend on it). CI release runners install with strict pnpm
// isolation and a frozen lockfile, where the renderer can't see it. The
// rendered icons are committed in apps/desktop/build/ and
// apps/vscode/media/, so a missing Playwright is treated as "skip the
// refresh, use the committed assets" rather than a hard failure. If you
// genuinely want to re-render, run `pnpm icons` locally where the e2e
// workspace has installed Playwright.
const RESOLVE_ROOTS = [
  resolve(ROOT, 'apps/web/package.json'),
  resolve(ROOT, 'e2e/web/package.json'),
];
let chromium;
for (const root of RESOLVE_ROOTS) {
  try {
    const pw = createRequire(root)('@playwright/test');
    chromium = pw.chromium ?? pw.default?.chromium;
    if (chromium) break;
  } catch {
    // try next root
  }
}
if (!chromium) {
  console.warn(
    '[render-icons] @playwright/test not resolvable — ' +
      'skipping icon rasterisation. The committed apps/desktop/build/icon.* ' +
      'and apps/vscode/media/icon-marketplace.png assets will be used as-is.',
  );
  process.exit(0);
}

const requireFromRoot = createRequire(resolve(ROOT, 'package.json'));
const png2icons = requireFromRoot('png2icons');

const SVG_PATH = resolve(ROOT, 'apps/web/public/favicon.svg');
const BUILD_DIR = resolve(ROOT, 'apps/desktop/build');
const PER_SIZE_DIR = join(BUILD_DIR, 'icons');

// Sizes the OS launchers actually read. The ICO/ICNS packers downsample
// internally from the 1024 master, but per-size PNGs are useful for:
//   - BrowserWindow.icon (dev mode, no .ico available on Linux)
//   - Linux .desktop entries / freedesktop hicolor theme
//   - Future tray-icon use (16/32 needed)
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

async function rasterize(svg, size, browser) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body { margin:0; padding:0; background:transparent; }
  #wrap { width:${size}px; height:${size}px; }
  #wrap > svg { width:100%; height:100%; display:block; }
</style></head>
<body><div id="wrap">${svg}</div></body></html>`;

  const ctx = await browser.newContext({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const el = await page.$('#wrap');
  const buf = await el.screenshot({ omitBackground: true, type: 'png' });
  await ctx.close();
  return buf;
}

async function main() {
  const svg = await readFile(SVG_PATH, 'utf8');
  await mkdir(BUILD_DIR, { recursive: true });
  // Clean per-size dir so stale sizes don't accumulate.
  await rm(PER_SIZE_DIR, { recursive: true, force: true });
  await mkdir(PER_SIZE_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    // Rasterize each target size in parallel. Playwright is happy with one
    // browser + many contexts, and the SVG is tiny so this finishes in
    // ~3s total on a laptop.
    const pngs = await Promise.all(
      PNG_SIZES.map(async (size) => {
        const buf = await rasterize(svg, size, browser);
        await writeFile(join(PER_SIZE_DIR, `${size}.png`), buf);
        return { size, buf };
      }),
    );

    const master = pngs.find((p) => p.size === 1024);
    if (!master) throw new Error('1024 master missing — PNG_SIZES regression?');

    // Linux + electron-builder default
    await writeFile(join(BUILD_DIR, 'icon.png'), master.buf);
    // Legacy alias kept for any tooling still reading the old name.
    await writeFile(join(BUILD_DIR, 'icon-transparent.png'), master.buf);

    // Windows .ico — embeds multi-resolution rasters so Windows can pick the
    // right size for the taskbar, alt-tab, and Explorer thumbnails.
    const ico = png2icons.createICO(
      master.buf,
      png2icons.BICUBIC,
      0,
      true /* multi-resolution */,
      true /* transparent */,
    );
    if (!ico) throw new Error('png2icons.createICO returned null');
    await writeFile(join(BUILD_DIR, 'icon.ico'), ico);

    // macOS .icns — same idea, all standard slots from 16 to 1024 @2x.
    const icns = png2icons.createICNS(master.buf, png2icons.BICUBIC, 0);
    if (!icns) throw new Error('png2icons.createICNS returned null');
    await writeFile(join(BUILD_DIR, 'icon.icns'), icns);

    const sizesList = pngs.map((p) => `${p.size}px (${p.buf.byteLength}B)`).join(', ');
    console.log(`✓ ${PNG_SIZES.length} PNGs in build/icons/: ${sizesList}`);
    console.log(`✓ build/icon.png        (1024×1024)`);
    console.log(`✓ build/icon.ico        (${ico.byteLength}B, multi-res)`);
    console.log(`✓ build/icon.icns       (${icns.byteLength}B, multi-res)`);

    // VS Code Marketplace icon — colorful brand on the dark galleryBanner
    // background (#1f1b2e) so the icon pops on both light and dark themes
    // instead of the old black-on-white monochrome variant.
    const MARKETPLACE_SIZE = 256;
    const MARKETPLACE_BG = '#1f1b2e';
    const MARKETPLACE_OUT = resolve(ROOT, 'apps/vscode/media/icon-marketplace.png');

    const mktHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:${MARKETPLACE_BG};}
  #wrap{width:${MARKETPLACE_SIZE}px;height:${MARKETPLACE_SIZE}px;
        display:flex;align-items:center;justify-content:center;}
  #wrap>svg{width:80%;height:80%;display:block;}
</style></head>
<body><div id="wrap">${svg}</div></body></html>`;

    const mktCtx = await browser.newContext({
      viewport: { width: MARKETPLACE_SIZE, height: MARKETPLACE_SIZE },
      deviceScaleFactor: 1,
    });
    const mktPage = await mktCtx.newPage();
    await mktPage.setContent(mktHtml, { waitUntil: 'load' });
    const mktEl = await mktPage.$('#wrap');
    const mktBuf = await mktEl.screenshot({ type: 'png' });
    await mktCtx.close();
    await writeFile(MARKETPLACE_OUT, mktBuf);
    console.log(`✓ apps/vscode/media/icon-marketplace.png (${MARKETPLACE_SIZE}×${MARKETPLACE_SIZE}, ${mktBuf.byteLength}B)`);
  } finally {
    await browser.close();
  }
}

await main();
