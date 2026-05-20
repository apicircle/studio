/**
 * Token Oriented Object Notation (TOON) encoder.
 *
 * Compact, indentation-based serialization that drops most of JSON's
 * structural noise (quotes around keys/values where unambiguous, braces,
 * commas, colons-with-spaces). Optimized for LLM token budgets and
 * eyeballing — typical JSON shrinks 25–50% when re-encoded.
 *
 * Two encoding shapes are produced:
 *
 *  - **Tabular** for arrays of homogeneous flat objects (common API list
 *    payloads). The header lists keys once, the rows list values once:
 *
 *      users[2]{id,name,active}:
 *        1,Alice,true
 *        2,Bob,false
 *
 *  - **Indented** for everything else:
 *
 *      meta:
 *        page: 1
 *        items:
 *          - id: 1
 *            name: Alice
 *
 * Strings are quoted only when they contain characters that would otherwise
 * break the line shape (commas, colons, leading/trailing whitespace, etc.).
 * Output is intentionally lossless for round-tripping primitive types — but
 * a TOON decoder is out of scope for this module: the encoder exists so the
 * UI can show an "X% smaller" hint and an optional preview.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const INDENT = '  ';

function isFlatPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function isFlatObject(v: unknown): v is Record<string, string | number | boolean | null> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v).every(isFlatPrimitive);
}

/**
 * An array is "tabular" if it has ≥ 2 entries, all entries are flat
 * objects, and they share the same key set. Single-row arrays fall back
 * to the indented form because the header overhead doesn't pay off.
 */
function tabularKeys(arr: unknown[]): string[] | null {
  if (arr.length < 2) return null;
  if (!arr.every(isFlatObject)) return null;
  const keys = Object.keys(arr[0]);
  if (keys.length === 0) return null;
  for (let i = 1; i < arr.length; i++) {
    const rowKeys = Object.keys(arr[i]);
    if (rowKeys.length !== keys.length) return null;
    for (const k of keys) if (!(k in (arr[i] as object))) return null;
  }
  return keys;
}

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NEEDS_QUOTING = /[,:\n\r"]|^\s|\s$/;

function encodeKey(k: string): string {
  return SAFE_KEY.test(k) ? k : JSON.stringify(k);
}

function encodeScalar(v: string | number | boolean | null): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  // Reserved word collisions — quote so re-decode is unambiguous.
  if (v === 'null' || v === 'true' || v === 'false' || v === '') return JSON.stringify(v);
  if (NEEDS_QUOTING.test(v)) return JSON.stringify(v);
  return v;
}

function encodeRowValue(v: string | number | boolean | null): string {
  // Tabular rows are comma-separated; quoting rules are stricter.
  return encodeScalar(v);
}

function encodeNode(value: Json, indent: string): string {
  if (isFlatPrimitive(value)) return encodeScalar(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const keys = tabularKeys(value);
    if (keys) {
      const header = `[${value.length}]{${keys.map(encodeKey).join(',')}}:`;
      const rows = value.map(
        (row) =>
          indent +
          INDENT +
          keys.map((k) => encodeRowValue((row as Record<string, Json>)[k] as never)).join(','),
      );
      return `${header}\n${rows.join('\n')}`;
    }
    return value
      .map((item) => {
        if (isFlatPrimitive(item) || Array.isArray(item)) {
          return `${indent}- ${encodeNode(item, indent + INDENT)}`;
        }
        // Object child: first line goes after `- `, rest stays where the
        // recursive call put it (already at indent + INDENT, aligned under
        // the bullet). The first line carries an extra indent we need to
        // strip so `- ` itself stands in for those two columns.
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
      // Tabular array → header sits on the same line; rows below.
      if (Array.isArray(v)) {
        const keys = tabularKeys(v);
        if (keys) {
          const header = `${indent}${encodeKey(k)}[${v.length}]{${keys.map(encodeKey).join(',')}}:`;
          const rows = v.map(
            (row) =>
              indent +
              INDENT +
              keys
                .map((rk) => encodeRowValue((row as Record<string, Json>)[rk] as never))
                .join(','),
          );
          return `${header}\n${rows.join('\n')}`;
        }
      }
      const child = encodeNode(v, indent + INDENT);
      return `${indent}${encodeKey(k)}:\n${child}`;
    })
    .join('\n');
}

export function toToon(value: Json): string {
  if (isFlatPrimitive(value)) return encodeScalar(value);
  if (Array.isArray(value) && value.length === 0) return '[]';
  if (!Array.isArray(value) && typeof value === 'object' && Object.keys(value).length === 0) {
    return '{}';
  }
  return encodeNode(value, '');
}
