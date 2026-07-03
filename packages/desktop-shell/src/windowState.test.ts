import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/fake/userData') },
  screen: {
    getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
}));
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import * as fs from 'node:fs';
import { screen } from 'electron';
import { readWindowBounds, writeWindowBounds } from './windowState';

const readFileSync = vi.mocked(fs.readFileSync);
const writeFileSync = vi.mocked(fs.writeFileSync);
const getDisplayMatching = vi.mocked(screen.getDisplayMatching);

beforeEach(() => {
  vi.clearAllMocks();
  getDisplayMatching.mockReturnValue({
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  } as unknown as Electron.Display);
});

describe('readWindowBounds', () => {
  it('returns persisted bounds that sit within a live display', () => {
    readFileSync.mockReturnValue(JSON.stringify({ x: 100, y: 100, width: 1280, height: 820 }));
    expect(readWindowBounds()).toEqual({ x: 100, y: 100, width: 1280, height: 820 });
  });

  it('clamps to the display default when the saved frame is off-screen', () => {
    readFileSync.mockReturnValue(JSON.stringify({ x: 5000, y: 5000, width: 1280, height: 820 }));
    expect(readWindowBounds()).toEqual({ x: 0, y: 0, width: 1280, height: 820 });
  });

  it('shrinks the default to fit a smaller display', () => {
    getDisplayMatching.mockReturnValue({
      workArea: { x: 0, y: 0, width: 1000, height: 700 },
    } as unknown as Electron.Display);
    readFileSync.mockReturnValue(JSON.stringify({ x: 5000, y: 5000, width: 1280, height: 820 }));
    expect(readWindowBounds()).toEqual({ x: 0, y: 0, width: 1000, height: 700 });
  });

  it('returns undefined for a missing numeric field', () => {
    readFileSync.mockReturnValue(JSON.stringify({ x: 1, y: 1, width: 1280 }));
    expect(readWindowBounds()).toBeUndefined();
  });

  it('returns undefined for a too-small width', () => {
    readFileSync.mockReturnValue(JSON.stringify({ x: 1, y: 1, width: 500, height: 820 }));
    expect(readWindowBounds()).toBeUndefined();
  });

  it('returns undefined for a too-small height', () => {
    readFileSync.mockReturnValue(JSON.stringify({ x: 1, y: 1, width: 1280, height: 300 }));
    expect(readWindowBounds()).toBeUndefined();
  });

  it('returns undefined when the state file is missing or unreadable', () => {
    readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(readWindowBounds()).toBeUndefined();
  });
});

describe('writeWindowBounds', () => {
  it('persists the frame as JSON under userData', () => {
    writeWindowBounds({ x: 1, y: 2, width: 1280, height: 820 });
    expect(writeFileSync).toHaveBeenCalledOnce();
    const [, contents] = writeFileSync.mock.calls[0];
    expect(JSON.parse(contents as string)).toEqual({ x: 1, y: 2, width: 1280, height: 820 });
  });

  it('swallows write errors (niceness, not a contract)', () => {
    writeFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(() => writeWindowBounds({ x: 0, y: 0, width: 1280, height: 820 })).not.toThrow();
  });
});
