import { describe, expect, it } from 'vitest';
import {
  createAttachmentFromFile,
  deleteAttachment,
  deleteManyAttachments,
  getAttachment,
  materializeAttachment,
  putAttachment,
} from './attachments';

const sampleBytes = (str: string) => new TextEncoder().encode(str);

describe('attachments IDB store', () => {
  it('round-trips a record through putAttachment + getAttachment', async () => {
    await putAttachment({
      slotId: 'slot-1',
      filename: 'a.bin',
      mimeType: 'application/octet-stream',
      size: 3,
      sha256: '00',
      savedAt: '2026-04-27T00:00:00.000Z',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const got = await getAttachment('slot-1');
    expect(got).not.toBeNull();
    expect(got!.filename).toBe('a.bin');
    expect(got!.size).toBe(3);
    expect(Array.from(got!.bytes)).toEqual([1, 2, 3]);
  });

  it('returns null for missing slotIds', async () => {
    expect(await getAttachment('nope')).toBeNull();
  });

  it('deleteAttachment removes the record', async () => {
    await putAttachment({
      slotId: 'slot-2',
      filename: 'x',
      mimeType: 'text/plain',
      size: 1,
      sha256: '00',
      savedAt: '2026-04-27T00:00:00.000Z',
      bytes: sampleBytes('x'),
    });
    await deleteAttachment('slot-2');
    expect(await getAttachment('slot-2')).toBeNull();
  });

  it('deleteManyAttachments removes all listed records', async () => {
    for (const id of ['a', 'b', 'c']) {
      await putAttachment({
        slotId: id,
        filename: id,
        mimeType: 'text/plain',
        size: 1,
        sha256: '00',
        savedAt: 'now',
        bytes: sampleBytes(id),
      });
    }
    await deleteManyAttachments(['a', 'c']);
    expect(await getAttachment('a')).toBeNull();
    expect(await getAttachment('b')).not.toBeNull();
    expect(await getAttachment('c')).toBeNull();
  });

  it('deleteManyAttachments is a no-op for empty input', async () => {
    await expect(deleteManyAttachments([])).resolves.toBeUndefined();
  });

  describe('createAttachmentFromFile', () => {
    it('reads a File into bytes and copies metadata', async () => {
      const file = new File(['hello'], 'greet.txt', { type: 'text/plain' });
      const record = await createAttachmentFromFile(file, 'slot-x');
      expect(record.slotId).toBe('slot-x');
      expect(record.filename).toBe('greet.txt');
      expect(record.mimeType).toBe('text/plain');
      expect(record.size).toBe(5);
      expect(new TextDecoder().decode(record.bytes)).toBe('hello');
    });

    it('falls back to application/octet-stream when File has no type', async () => {
      const file = new File(['data'], 'unknown', { type: '' });
      const record = await createAttachmentFromFile(file, 's');
      expect(record.mimeType).toBe('application/octet-stream');
    });

    it('computes a stable SHA-256 hex digest of the bytes', async () => {
      const file = new File(['hello'], 'greet.txt', { type: 'text/plain' });
      const record = await createAttachmentFromFile(file, 'slot-h');
      // Reference hash of the UTF-8 string "hello".
      expect(record.sha256).toBe(
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      );
      // Same bytes → same hash.
      const again = await createAttachmentFromFile(
        new File(['hello'], 'greet.txt', { type: 'text/plain' }),
        'slot-h2',
      );
      expect(again.sha256).toBe(record.sha256);
    });
  });

  describe('materializeAttachment', () => {
    it('produces a Blob with the stored MIME type', () => {
      const blob = materializeAttachment({
        slotId: 's',
        filename: 'f',
        mimeType: 'image/png',
        size: 4,
        sha256: '00',
        savedAt: 'now',
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/png');
      expect(blob.size).toBe(4);
    });
  });
});
