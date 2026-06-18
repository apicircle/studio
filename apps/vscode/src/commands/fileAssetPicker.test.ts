import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspacePatch } from '@apicircle/core';
import { Uri, window } from '../../test/mocks/vscode';
import { guessMimeType, pickGlobalFileAsset } from './fileAssetPicker';
import type { VsCodeBridge } from '../host/vscodeBridge';

describe('guessMimeType', () => {
  it.each([
    ['report.json', 'application/json'],
    ['data.xml', 'application/xml'],
    ['note.txt', 'text/plain'],
    ['rows.csv', 'text/csv'],
    ['index.html', 'text/html'],
    ['index.htm', 'text/html'],
    ['readme.md', 'text/markdown'],
    ['contract.pdf', 'application/pdf'],
    ['logo.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.JPEG', 'image/jpeg'],
    ['anim.gif', 'image/gif'],
    ['icon.svg', 'image/svg+xml'],
    ['shot.webp', 'image/webp'],
    ['bundle.zip', 'application/zip'],
    ['archive.gz', 'application/gzip'],
    ['playbook.yaml', 'application/yaml'],
    ['playbook.yml', 'application/yaml'],
  ])('maps %s → %s', (filename, expected) => {
    expect(guessMimeType(filename)).toBe(expected);
  });

  it('falls back to application/octet-stream for unknown extensions', () => {
    expect(guessMimeType('weird.xyz')).toBe('application/octet-stream');
    expect(guessMimeType('no-extension')).toBe('application/octet-stream');
  });

  it('is case-insensitive', () => {
    expect(guessMimeType('Report.JSON')).toBe('application/json');
  });
});

function makeBridge(
  files: Record<string, unknown> = {},
  apicircleDir = '/tmp/.apicircle',
): { bridge: VsCodeBridge; applied: WorkspacePatch[] } {
  const applied: WorkspacePatch[] = [];
  const surface = {
    workspace: { id: 'ws-1', name: 'demo', apicircleDir },
    read: vi.fn(async () => ({
      synced: { globalAssets: { files } } as never,
      local: {} as never,
    })),
    apply: vi.fn(async (patch: WorkspacePatch) => {
      applied.push(patch);
    }),
    write: vi.fn(),
  };
  return {
    bridge: {
      activeWorkspace: () => surface as unknown as ReturnType<VsCodeBridge['activeWorkspace']>,
    } as unknown as VsCodeBridge,
    applied,
  };
}

function reset(): void {
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (window.showQuickPick as Mock).mockReset();
}

describe('pickGlobalFileAsset', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fileasset-'));
    reset();
  });

  it('warns when no active workspace and returns undefined', async () => {
    const bridge = { activeWorkspace: () => null } as unknown as VsCodeBridge;
    const out = await pickGlobalFileAsset({ bridge });
    expect(out).toBeUndefined();
    expect(window.showWarningMessage).toHaveBeenCalledWith('No active API Circle workspace.');
  });

  it('returns undefined when the picker is dismissed', async () => {
    const { bridge } = makeBridge();
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    const out = await pickGlobalFileAsset({ bridge });
    expect(out).toBeUndefined();
  });

  it('returns the matching library file when an existing item is picked', async () => {
    const existing = {
      id: 'f-1',
      name: 'data.json',
      slotId: 'slot-1',
      filename: 'data.json',
      size: 100,
      mimeType: 'application/json',
      sha256: 'aaa',
      createdAt: 't',
      updatedAt: 't',
    };
    const { bridge } = makeBridge({ 'f-1': existing });
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'f-1' });
    const out = await pickGlobalFileAsset({ bridge });
    expect(out?.id).toBe('f-1');
  });

  it('returns undefined when the open dialog is cancelled during upload', async () => {
    const { bridge } = makeBridge();
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '__upload__' });
    const showOpenDialog = vi.fn(async () => undefined);
    const out = await pickGlobalFileAsset({ bridge, showOpenDialog });
    expect(out).toBeUndefined();
  });

  it('reads the file, copies it under attachments/, and registers the asset via globalAsset.upsertFile', async () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    fs.mkdirSync(apicircleDir, { recursive: true });
    const src = path.join(tmp, 'photo.png');
    fs.writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { bridge, applied } = makeBridge({}, apicircleDir);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '__upload__' });
    const showOpenDialog = vi.fn(async () => [Uri.file(src)]);
    const writeAttachment = vi.fn(async () => undefined);
    const out = await pickGlobalFileAsset({ bridge, showOpenDialog, writeAttachment });
    expect(out).toBeDefined();
    expect(out?.mimeType).toBe('image/png');
    expect(out?.filename).toBe('photo.png');
    expect(out?.size).toBe(4);
    expect(writeAttachment).toHaveBeenCalledTimes(1);
    expect(applied).toHaveLength(1);
    expect(applied[0].kind).toBe('globalAsset.upsertFile');
  });

  it('surfaces an error when the source file cannot be read', async () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    fs.mkdirSync(apicircleDir, { recursive: true });
    const missing = path.join(tmp, 'missing.bin');
    const { bridge } = makeBridge({}, apicircleDir);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '__upload__' });
    const showOpenDialog = vi.fn(async () => [Uri.file(missing)]);
    const out = await pickGlobalFileAsset({ bridge, showOpenDialog });
    expect(out).toBeUndefined();
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/Failed to read/));
  });

  it('surfaces an error when the on-disk attachment write fails', async () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    fs.mkdirSync(apicircleDir, { recursive: true });
    const src = path.join(tmp, 'data.bin');
    fs.writeFileSync(src, Buffer.from([1, 2, 3]));
    const { bridge } = makeBridge({}, apicircleDir);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '__upload__' });
    const showOpenDialog = vi.fn(async () => [Uri.file(src)]);
    const writeAttachment = vi.fn(async () => {
      throw new Error('disk full');
    });
    const out = await pickGlobalFileAsset({ bridge, showOpenDialog, writeAttachment });
    expect(out).toBeUndefined();
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to write attachment.*disk full/),
    );
  });

  it('uses a custom attachmentPathFor when provided', async () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    fs.mkdirSync(apicircleDir, { recursive: true });
    const src = path.join(tmp, 'data.bin');
    fs.writeFileSync(src, Buffer.from([42]));
    const { bridge } = makeBridge({}, apicircleDir);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '__upload__' });
    const customPaths: string[] = [];
    const attachmentPathFor = vi.fn((dir: string, slot: string) => {
      const p = path.join(tmp, 'custom', slot);
      customPaths.push(p);
      return p;
    });
    const writeAttachment = vi.fn(async () => undefined);
    await pickGlobalFileAsset({
      bridge,
      showOpenDialog: vi.fn(async () => [Uri.file(src)]),
      attachmentPathFor,
      writeAttachment,
    });
    expect(attachmentPathFor).toHaveBeenCalledWith(apicircleDir, expect.any(String));
    expect(customPaths[0]).toContain(path.join('custom', ''));
  });

  it('uses the real fs writer when no writeAttachment override is given', async () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    fs.mkdirSync(apicircleDir, { recursive: true });
    const src = path.join(tmp, 'data.bin');
    fs.writeFileSync(src, Buffer.from([7, 8, 9]));
    const { bridge } = makeBridge({}, apicircleDir);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '__upload__' });
    const out = await pickGlobalFileAsset({
      bridge,
      showOpenDialog: vi.fn(async () => [Uri.file(src)]),
    });
    expect(out).toBeDefined();
    expect(fs.existsSync(path.join(apicircleDir, 'attachments', out!.slotId))).toBe(true);
  });
});
