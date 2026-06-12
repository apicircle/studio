import { describe, expect, it } from 'vitest';
import {
  buildBodySubtree,
  buildConditionClause,
  collectJsonArrayPaths,
  leadingIndent,
  replaceScalarOnLine,
  yamlScalar,
} from './mockFieldEdits';

describe('replaceScalarOnLine', () => {
  it('replaces the value of a plain key row, preserving indent + key', () => {
    expect(replaceScalarOnLine('  status: 200', '404')).toBe('  status: 404');
    expect(replaceScalarOnLine('method: GET', 'POST')).toBe('method: POST');
  });

  it('handles dash rows (`- key:`)', () => {
    expect(replaceScalarOnLine('    - key: Content-Type', "'X-Api-Key'")).toBe(
      "    - key: 'X-Api-Key'",
    );
  });

  it('handles deeply-indented value rows', () => {
    expect(replaceScalarOnLine('          value: x', "'application/json'")).toBe(
      "          value: 'application/json'",
    );
  });

  it('returns null for a non key:value line', () => {
    expect(replaceScalarOnLine('   # a comment', 'x')).toBeNull();
    expect(replaceScalarOnLine('', 'x')).toBeNull();
  });
});

describe('leadingIndent', () => {
  it('counts leading spaces', () => {
    expect(leadingIndent('      value: x')).toBe(6);
    expect(leadingIndent('no-indent')).toBe(0);
  });
});

describe('yamlScalar', () => {
  it('single-quotes plain strings', () => {
    expect(yamlScalar('application/json')).toBe("'application/json'");
    expect(yamlScalar('pageSize')).toBe("'pageSize'");
  });
  it('double-quotes strings with YAML-significant chars (incl. a quote)', () => {
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar("it's")).toBe('"it\'s"');
  });
  it('emits empty-string marker', () => {
    expect(yamlScalar('')).toBe("''");
  });
});

describe('buildBodySubtree', () => {
  it('emits type + content at the given indent', () => {
    expect(buildBodySubtree(4, 'json')).toBe("    type: json\n    content: ''");
    expect(buildBodySubtree(8, 'text')).toBe("        type: text\n        content: ''");
  });
  it('adds formRows for form-data', () => {
    expect(buildBodySubtree(4, 'form-data')).toBe(
      "    type: form-data\n    content: ''\n    formRows: []",
    );
  });
});

describe('buildConditionClause', () => {
  it('renders a fresh AND-clause at the dash indent', () => {
    const out = buildConditionClause(6, 'c-new');
    expect(out).toBe(
      [
        "      - id: 'c-new'",
        '        scope: query',
        "        target: ''",
        '        op: equals',
        "        value: ''",
      ].join('\n'),
    );
  });
});

describe('collectJsonArrayPaths', () => {
  it('finds top-level and nested array paths', () => {
    const paths = collectJsonArrayPaths({
      items: [{ id: 1 }],
      data: { results: [{ x: 1 }], total: 5 },
      name: 'x',
    });
    expect(paths).toContain('$.items');
    expect(paths).toContain('$.data.results');
    expect(paths).not.toContain('$.name');
  });

  it('reports the root when the body itself is an array', () => {
    expect(collectJsonArrayPaths([{ id: 1 }])).toContain('$');
  });

  it('descends into the first element to surface arrays of arrays', () => {
    const paths = collectJsonArrayPaths({ rows: [{ cells: [1, 2] }] });
    expect(paths).toContain('$.rows');
    expect(paths).toContain('$.rows[0].cells');
  });

  it('returns [] for scalar / object-only bodies', () => {
    expect(collectJsonArrayPaths({ a: 1, b: { c: 2 } })).toEqual([]);
    expect(collectJsonArrayPaths(42)).toEqual([]);
  });
});
