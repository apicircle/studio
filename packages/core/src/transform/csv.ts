/**
 * Minimal RFC 4180-ish CSV encoder, used purely as a "what if you sent
 * this as CSV" savings preview. Returns null when the input isn't an
 * array of homogeneous flat objects — CSV only makes sense for tabular
 * data, and forcing it on nested JSON would either lose information or
 * inflate the payload, defeating the point of the savings hint.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function isFlat(v: unknown): v is string | number | boolean | null {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function isFlatRow(v: unknown): v is Record<string, string | number | boolean | null> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v).every(isFlat);
}

const NEEDS_QUOTING = /[",\r\n]/;

function escapeCell(v: string | number | boolean | null): string {
  if (v === null) return '';
  const s = typeof v === 'string' ? v : String(v);
  return NEEDS_QUOTING.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(value: Json): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every(isFlatRow)) return null;

  const keys = Object.keys(value[0]);
  if (keys.length === 0) return null;
  for (let i = 1; i < value.length; i++) {
    const row = value[i] as Record<string, unknown>;
    if (Object.keys(row).length !== keys.length) return null;
    for (const k of keys) if (!(k in row)) return null;
  }

  const lines = [keys.map(escapeCell).join(',')];
  for (const row of value) {
    lines.push(keys.map((k) => escapeCell((row as Record<string, Json>)[k] as never)).join(','));
  }
  return lines.join('\n');
}
