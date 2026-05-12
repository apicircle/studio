// Window-bounds persistence. Read/write a tiny JSON file under userData
// so the BrowserWindow opens at the user's last-used size + position
// instead of the same top-left default every launch.
//
// Defensive on read: if the file is missing, malformed, or claims a
// monitor that no longer exists, we fall back to the canonical defaults
// rather than throw. Electron's `getDisplayMatching` clamps to a real
// display, so an off-screen restore is impossible.

import { app, type Rectangle, screen } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULTS: Rectangle = { x: 0, y: 0, width: 1280, height: 820 };

function statePath(): string {
  return path.join(app.getPath('userData'), 'window.json');
}

/**
 * Read persisted bounds. Returns the rectangle to pass into BrowserWindow,
 * or undefined when there is no usable persisted state (Electron picks
 * its default in that case).
 */
export function readWindowBounds(): Rectangle | undefined {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Rectangle>;
    const { x, y, width, height } = parsed;
    if (
      typeof x === 'number' &&
      typeof y === 'number' &&
      typeof width === 'number' &&
      typeof height === 'number' &&
      width >= 600 &&
      height >= 400
    ) {
      // Clamp to a display that still exists — otherwise a window opens
      // on a disconnected monitor and is effectively invisible.
      const target = screen.getDisplayMatching({ x, y, width, height });
      const within =
        x >= target.workArea.x &&
        y >= target.workArea.y &&
        x + width <= target.workArea.x + target.workArea.width &&
        y + height <= target.workArea.y + target.workArea.height;
      if (within) return { x, y, width, height };
      // Display present but the saved frame is off-screen → use defaults
      // sized to fit the chosen display.
      return {
        x: target.workArea.x,
        y: target.workArea.y,
        width: Math.min(DEFAULTS.width, target.workArea.width),
        height: Math.min(DEFAULTS.height, target.workArea.height),
      };
    }
  } catch {
    // Missing / corrupt — fall through to defaults.
  }
  return undefined;
}

/** Persist the current frame. Errors are swallowed; this is a niceness, not a contract. */
export function writeWindowBounds(bounds: Rectangle): void {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(bounds), 'utf8');
  } catch {
    // No userData dir, full disk, perms — none of those should crash the app.
  }
}
