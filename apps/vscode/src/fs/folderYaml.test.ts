import { describe, it, expect } from 'vitest';
import type { Folder, RequestAuth } from '@apicircle/shared';
import { serializeFolderToYaml, parseFolderFromYaml, FolderYamlParseError } from './folderYaml';

function folder(over: Partial<Folder> = {}): Folder {
  return { id: 'f1', name: 'Auth', parentId: null, ...over };
}

describe('serializeFolderToYaml', () => {
  it('emits name only when no auth is set', () => {
    const yaml = serializeFolderToYaml(folder({ name: 'Public' }));
    expect(yaml).toContain('name: Public');
    // No top-level `auth:` key. The header comment mentions "auth" prose;
    // strip comment lines before asserting on the doc body.
    const body = yaml
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(body).not.toMatch(/^auth:/m);
  });

  it('emits auth when the folder carries one', () => {
    const yaml = serializeFolderToYaml(
      folder({ auth: { type: 'bearer', token: 'TOKEN' } as RequestAuth }),
    );
    expect(yaml).toContain('auth:');
    expect(yaml).toContain('type: bearer');
    expect(yaml).toContain('token: TOKEN');
  });

  it('includes the header comment explaining inherit semantics', () => {
    const yaml = serializeFolderToYaml(folder());
    expect(yaml).toMatch(/APICircle Folder/);
    expect(yaml).toMatch(/inherit/);
  });
});

describe('parseFolderFromYaml', () => {
  it('round-trips a folder with auth', () => {
    const original = folder({
      name: 'API v2',
      auth: { type: 'bearer', token: 'tok' } as RequestAuth,
    });
    const yaml = serializeFolderToYaml(original);
    const { patch } = parseFolderFromYaml(yaml);
    expect(patch.name).toBe('API v2');
    expect(patch.auth).toEqual({ type: 'bearer', token: 'tok' });
  });

  it('round-trips a folder without auth (auth becomes undefined)', () => {
    const yaml = serializeFolderToYaml(folder({ name: 'Simple' }));
    const { patch } = parseFolderFromYaml(yaml);
    expect(patch.name).toBe('Simple');
    expect(patch.auth).toBeUndefined();
  });

  it('rejects missing name', () => {
    expect(() => parseFolderFromYaml('auth: { type: none }')).toThrow(FolderYamlParseError);
  });

  it('rejects an empty name', () => {
    expect(() => parseFolderFromYaml('name: "   "')).toThrow(/empty/);
  });

  it('rejects unknown top-level keys (typo guard)', () => {
    expect(() => parseFolderFromYaml('name: A\nnam: B')).toThrow(/Unknown field/);
  });

  it('rejects non-mapping auth', () => {
    expect(() => parseFolderFromYaml('name: A\nauth: invalid')).toThrow(/mapping/);
  });

  it('rejects auth missing a type', () => {
    expect(() => parseFolderFromYaml('name: A\nauth: { token: abc }')).toThrow(/type/);
  });

  it('rejects invalid YAML', () => {
    expect(() => parseFolderFromYaml(': : : :')).toThrow(FolderYamlParseError);
  });
});
