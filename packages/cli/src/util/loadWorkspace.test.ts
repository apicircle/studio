import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureWorkspace } from './loadWorkspace';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-cli-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ensureWorkspace', () => {
  it('creates a fresh workspace pair on first invocation', async () => {
    const dir = path.join(tmpDir, 'ws');
    const state = await ensureWorkspace(dir);
    expect(state.synced.workspaceId).toBe(state.local.workspaceId);
    expect(state.synced.mockServers).toEqual({});
    const stat = await fs.stat(path.join(dir, 'workspace.json'));
    expect(stat.isFile()).toBe(true);
  });

  it('returns the existing workspace when the dir already has one', async () => {
    const dir = path.join(tmpDir, 'ws');
    const first = await ensureWorkspace(dir);
    const second = await ensureWorkspace(dir);
    expect(second.synced.workspaceId).toBe(first.synced.workspaceId);
  });
});
