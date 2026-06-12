import { describe, it, expect } from 'vitest';
import { renderHeaderRow, __testHooks } from './pickHeader';

const { HEADERS } = __testHooks;

describe('renderHeaderRow', () => {
  it('writes a three-line key/value/enabled block with single-quoted strings', () => {
    expect(renderHeaderRow('Accept', 'application/json')).toBe(
      [`  - key: 'Accept'`, `    value: 'application/json'`, '    enabled: true'].join('\n') + '\n',
    );
  });

  it('double-quotes values that contain YAML special chars', () => {
    expect(renderHeaderRow('X-Trace-Id', 'a:b:c')).toContain('"a:b:c"');
  });
});

describe('header catalogue', () => {
  it('covers the staples + the auth / api-key escape hatches', () => {
    const names = HEADERS.map((h) => h.name);
    for (const expected of [
      'Accept',
      'Authorization',
      'Cache-Control',
      'Content-Type',
      'User-Agent',
      'X-API-Key',
      'X-Request-ID',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('every catalogue entry has a non-empty description', () => {
    for (const h of HEADERS) {
      expect(h.description.length).toBeGreaterThan(0);
    }
  });
});
