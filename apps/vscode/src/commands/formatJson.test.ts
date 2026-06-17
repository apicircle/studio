import { describe, expect, it } from 'vitest';
import { reformatJsonContentAt, type JsonReformat } from './formatJson';

// =============================================================================
// Pure-helper tests for the ⟳ Format JSON reflow. Each case feeds a YAML
// fragment + the `content:` line index and asserts the rewritten range.
// =============================================================================

/** Narrow the result to a JsonReformat (fail the test if empty / null). */
function reformat(text: string, line: number): JsonReformat {
  const r = reformatJsonContentAt(text, line);
  if (r === null || 'empty' in r)
    throw new Error('expected a JSON reformat, got ' + JSON.stringify(r));
  return r;
}

describe('reformatJsonContentAt', () => {
  it('reflows an inline single-quoted stringified JSON body into a block scalar', () => {
    const text = ['defaultResponse:', '  body:', '    content: \'{"a":1,"b":2}\''].join('\n');
    const out = reformat(text, 2);
    expect(out.startLine).toBe(2);
    expect(out.endLine).toBe(2);
    expect(out.replacement).toBe(
      ['    content: |-', '      {', '        "a": 1,', '        "b": 2', '      }'].join('\n'),
    );
  });

  it('reflows an inline double-quoted stringified JSON body', () => {
    const text = ['  body:', '    content: "{\\"ok\\":true}"'].join('\n');
    const out = reformat(text, 1);
    expect(out.replacement).toBe(
      ['    content: |-', '      {', '        "ok": true', '      }'].join('\n'),
    );
  });

  it('re-pretties an existing (mis-indented) block scalar', () => {
    const text = ['    content: |-', '      {"x": [1,2]}', '  status: 200'].join('\n');
    const out = reformat(text, 0);
    // Only the content block (lines 0–1) is replaced; status: stays put.
    expect(out.startLine).toBe(0);
    expect(out.endLine).toBe(1);
    expect(out.replacement).toBe(
      [
        '    content: |-',
        '      {',
        '        "x": [',
        '          1,',
        '          2',
        '        ]',
        '      }',
      ].join('\n'),
    );
  });

  it("reflows a real multiline block scalar (the serializer's pretty-printed shape)", () => {
    const text = [
      'body:',
      '  type: json',
      '  content: |-',
      '    {',
      '      "a":    1,',
      '      "b": 2',
      '    }',
    ].join('\n');
    const out = reformat(text, 2);
    expect(out.startLine).toBe(2);
    expect(out.endLine).toBe(6);
    expect(out.replacement).toBe(
      ['  content: |-', '    {', '      "a": 1,', '      "b": 2', '    }'].join('\n'),
    );
  });

  it('returns null for invalid JSON', () => {
    const text = ["    content: '{not json}'"].join('\n');
    expect(reformatJsonContentAt(text, 0)).toBeNull();
  });

  it('returns null when the line is not a content scalar', () => {
    const text = ['    status: 200'].join('\n');
    expect(reformatJsonContentAt(text, 0)).toBeNull();
  });

  it('signals empty (not an error) for blank content — bare, single- and double-quoted', () => {
    // The command silently skips these instead of raising "not valid JSON".
    expect(reformatJsonContentAt('    content:', 0)).toEqual({ empty: true });
    expect(reformatJsonContentAt("    content: ''", 0)).toEqual({ empty: true });
    expect(reformatJsonContentAt('    content: ""', 0)).toEqual({ empty: true });
    expect(reformatJsonContentAt('    variables: ""', 0)).toEqual({ empty: true });
    // A block scalar with only blank lines is also "empty".
    expect(reformatJsonContentAt(['  content: |-', '    ', '  next: 1'].join('\n'), 0)).toEqual({
      empty: true,
    });
  });

  it('reflows a non-content JSON key (graphql variables / auth payload), preserving the key', () => {
    const out = reformat('    variables: \'{"id":1}\'', 0);
    expect(out.replacement).toBe(
      ['    variables: |-', '      {', '        "id": 1', '      }'].join('\n'),
    );
    const payload = reformat('      payload: \'{"sub":"x"}\'', 0);
    expect(payload.replacement.startsWith('      payload: |-')).toBe(true);
  });

  it('never reflows a bare scalar value (a JSON-valid number / string)', () => {
    // `status: 200` parses as JSON (200) but must NOT become a block scalar.
    expect(reformatJsonContentAt('    status: 200', 0)).toBeNull();
    expect(reformatJsonContentAt('    name: \'"hello"\'', 0)).toBeNull();
  });
});
