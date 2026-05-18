/**
 * Minimal block-style YAML encoder. Sibling of `toon.ts` — same job
 * (compact, indentation-based representation of JSON-shaped data) but
 * sticks to standard YAML syntax instead of TOON's tabular shorthand,
 * so the user can compare the two.
 *
 * For arrays of homogeneous flat objects YAML still emits one list item
 * per row (unlike TOON's `name[count]{cols}: rows` table), so YAML is
 * usually slightly larger than TOON on tabular payloads but identical or
 * very close on nested ones. Keeping both gives the user the full picture
 * when deciding which format to feed downstream.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const INDENT = '  ';

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
// YAML's plain scalar restrictions: leading/trailing whitespace, special
// indicators (`,`, `[`, `]`, `{`, `}`, `&`, `*`, `!`, `|`, `>`, `'`, `"`,
// `#`, `%`, `@`, `\``, `?`, `:` followed by space, leading `-`/space).
// We use a permissive screen — anything ambiguous gets JSON-quoted, which
// is valid YAML.
const NEEDS_QUOTING = /[:#,&*!|>'"`%@\n\r\t]|^[-?\s]|\s$|^$/;

function isFlatPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function encodeKey(k: string): string {
  return SAFE_KEY.test(k) ? k : JSON.stringify(k);
}

function encodeScalar(v: string | number | boolean | null): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  // Reserved word collisions — YAML 1.1 treats these as booleans.
  if (/^(null|true|false|yes|no|on|off|~)$/i.test(v)) return JSON.stringify(v);
  if (NEEDS_QUOTING.test(v)) return JSON.stringify(v);
  // Numeric-looking strings need quoting so they don't deserialize as numbers.
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return JSON.stringify(v);
  return v;
}

function encodeNode(value: Json, indent: string): string {
  if (isFlatPrimitive(value)) return encodeScalar(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        if (isFlatPrimitive(item)) return `${indent}- ${encodeScalar(item)}`;
        if (Array.isArray(item) && item.length === 0) return `${indent}- []`;
        if (
          !Array.isArray(item) &&
          typeof item === 'object' &&
          item !== null &&
          Object.keys(item).length === 0
        ) {
          return `${indent}- {}`;
        }
        const encoded = encodeNode(item, indent + INDENT);
        const innerIndent = indent + INDENT;
        const lines = encoded.split('\n');
        const [first, ...rest] = lines;
        const firstStripped = first.startsWith(innerIndent)
          ? first.slice(innerIndent.length)
          : first;
        return [`${indent}- ${firstStripped}`, ...rest].join('\n');
      })
      .join('\n');
  }
  // Object.
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  return entries
    .map(([k, v]) => {
      if (isFlatPrimitive(v)) return `${indent}${encodeKey(k)}: ${encodeScalar(v)}`;
      if (Array.isArray(v) && v.length === 0) return `${indent}${encodeKey(k)}: []`;
      if (!Array.isArray(v) && typeof v === 'object' && Object.keys(v).length === 0) {
        return `${indent}${encodeKey(k)}: {}`;
      }
      const child = encodeNode(v, indent + INDENT);
      return `${indent}${encodeKey(k)}:\n${child}`;
    })
    .join('\n');
}

export function toYaml(value: Json): string {
  if (isFlatPrimitive(value)) return encodeScalar(value);
  if (Array.isArray(value) && value.length === 0) return '[]';
  if (!Array.isArray(value) && typeof value === 'object' && Object.keys(value).length === 0) {
    return '{}';
  }
  return encodeNode(value, '');
}
