import { describe, it, expect } from 'vitest';
import { guessMimeType } from './fileAssetPicker';

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
