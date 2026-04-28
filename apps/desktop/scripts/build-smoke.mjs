// Plan §7.5.4 P8 smoke test: validate the desktop main + preload
// compile cleanly and the resulting bundles wire the bridge correctly.
// We don't actually launch Electron here — CI doesn't have a display —
// but we do verify the produced JS at the byte level so a renamed IPC
// channel or a removed contextBridge call fails the build immediately.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distMain = resolve(__dirname, '../dist/main/main.js');
const distPreload = resolve(__dirname, '../dist/main/preload.js');

let failed = false;
const fail = (msg) => {
  console.error(`✘ ${msg}`);
  failed = true;
};
const pass = (msg) => {
  console.log(`✓ ${msg}`);
};

if (!existsSync(distMain)) {
  fail(`main bundle missing at ${distMain} — run \`pnpm --filter @apicircle/desktop build\` first`);
} else {
  const mainSrc = readFileSync(distMain, 'utf8');
  for (const channel of [
    'apicircle:secret:isAvailable',
    'apicircle:secret:encrypt',
    'apicircle:secret:decrypt',
  ]) {
    if (!mainSrc.includes(channel)) {
      fail(`main bundle missing IPC channel "${channel}"`);
    } else {
      pass(`main wires IPC channel ${channel}`);
    }
  }
  if (!mainSrc.includes('safeStorage')) {
    fail('main bundle does not reference Electron safeStorage');
  } else {
    pass('main routes through safeStorage');
  }
}

if (!existsSync(distPreload)) {
  fail(`preload bundle missing at ${distPreload}`);
} else {
  const preloadSrc = readFileSync(distPreload, 'utf8');
  if (!preloadSrc.includes('apicircleDesktop')) {
    fail('preload bundle does not expose `apicircleDesktop` on the renderer window');
  } else {
    pass('preload exposes apicircleDesktop');
  }
  if (!preloadSrc.includes('contextBridge')) {
    fail('preload bundle does not use contextBridge — would leak ipcRenderer to the renderer');
  } else {
    pass('preload uses contextBridge (no raw ipcRenderer leak)');
  }
}

if (failed) {
  process.exitCode = 1;
  console.error('\nSmoke test failed.');
} else {
  console.log('\nSmoke test passed.');
}
