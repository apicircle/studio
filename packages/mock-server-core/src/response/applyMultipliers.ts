// Response multipliers — read a value from the inbound request, then repeat
// the array element at `targetJsonPath` inside the response body that many
// times. Only fires when the response body type is JSON; other body types
// (text/xml/binary/etc.) are returned unchanged.
//
// The config holds an ARRAY of multipliers (`MockResponseConfig.multipliers`).
// The authoring surfaces currently cap it at MAX_RESPONSE_MULTIPLIERS (1), but
// the runtime applies every entry it finds — so bumping the cap (or a manual
// edit) needs no engine change.
//
// Fallback rule: when the source value is missing or doesn't coerce to a
// finite integer, fall back to `defaultCount`. The resolved count is
// clamped to `[min, max]` when those bounds are set.
//
// Edge cases:
//   • The targetJsonPath doesn't resolve to an array → no-op (we don't
//     warn here — buildRouter has nowhere to log; the editor lints).
//   • The array is empty → no-op (no template to repeat).
//   • The body string isn't valid JSON → no-op (returns the original).

import type { MockResponseConfig, MockResponseMultiplier } from '@apicircle/shared';
import { resolveJsonPath } from '../rules/evaluate';
import type { RequestContext } from '../rules/evaluate';

export function applyMultipliers(
  response: MockResponseConfig,
  ctx: RequestContext,
): MockResponseConfig {
  const multipliers = response.multipliers;
  if (!multipliers || multipliers.length === 0) return response;
  if (response.body.type !== 'json') return response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body.content);
  } catch {
    return response;
  }

  let mutated = false;
  for (const multiplier of multipliers) {
    const count = resolveCount(multiplier, ctx);
    if (count === null) continue;
    const next = applyOneMultiplier(parsed, multiplier.targetJsonPath, count);
    if (next.changed) {
      parsed = next.value;
      mutated = true;
    }
  }

  if (!mutated) return response;

  return {
    ...response,
    body: { type: 'json', content: JSON.stringify(parsed) },
  };
}

function resolveCount(multiplier: MockResponseMultiplier, ctx: RequestContext): number | null {
  const raw = readSource(multiplier, ctx);
  let count: number;
  if (raw === undefined || raw === '' || raw === null) {
    count = multiplier.defaultCount;
  } else {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      count = multiplier.defaultCount;
    } else {
      count = Math.trunc(parsed);
    }
  }

  if (multiplier.min !== undefined && count < multiplier.min) count = multiplier.min;
  if (multiplier.max !== undefined && count > multiplier.max) count = multiplier.max;
  if (count < 0) count = 0;
  return count;
}

function readSource(multiplier: MockResponseMultiplier, ctx: RequestContext): unknown {
  const { kind, key } = multiplier.source;
  switch (kind) {
    case 'query':
      return ctx.query[key];
    case 'pathParam':
      return ctx.pathParams[key];
    case 'header':
      return ctx.headers[key.toLowerCase()];
    case 'body-json-path':
      return resolveJsonPath(ctx.bodyJson, key);
  }
}

interface ApplyResult {
  changed: boolean;
  value: unknown;
}

/**
 * Walk the JSON path on the parsed body, repeat the first array element
 * `count` times, and return the new tree. Pure — never mutates `body`.
 */
function applyOneMultiplier(body: unknown, jsonPath: string, count: number): ApplyResult {
  const segments = parsePathSegments(jsonPath);
  if (segments.length === 0) {
    if (Array.isArray(body) && body.length > 0) {
      return { changed: true, value: repeatArray(body, count) };
    }
    return { changed: false, value: body };
  }
  return setAtPath(body, segments, 0, count);
}

type PathSegment = { kind: 'key'; name: string } | { kind: 'index'; idx: number };

// Names we never traverse into, even if the user-supplied path explicitly
// requests them. `__proto__`/`constructor`/`prototype` always resolve via the
// prototype chain on plain objects and have no place in a JSON multiplier.
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function parsePathSegments(jsonPath: string): PathSegment[] {
  let path = jsonPath.trim();
  if (path.startsWith('$')) path = path.slice(1);
  if (path.startsWith('.')) path = path.slice(1);
  if (path === '') return [];

  const out: PathSegment[] = [];
  const re = /([^.[\]]+)|\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) {
    if (match[1] !== undefined) {
      if (FORBIDDEN_KEYS.has(match[1])) return [];
      out.push({ kind: 'key', name: match[1] });
    } else if (match[2] !== undefined) {
      const n = Number(match[2]);
      if (Number.isInteger(n)) {
        out.push({ kind: 'index', idx: n });
      } else {
        if (FORBIDDEN_KEYS.has(match[2])) return [];
        out.push({ kind: 'key', name: match[2] });
      }
    }
  }
  return out;
}

function setAtPath(
  cursor: unknown,
  segments: PathSegment[],
  depth: number,
  count: number,
): ApplyResult {
  if (depth === segments.length) {
    if (Array.isArray(cursor) && cursor.length > 0) {
      return { changed: true, value: repeatArray(cursor, count) };
    }
    return { changed: false, value: cursor };
  }
  const seg = segments[depth];
  if (seg.kind === 'index') {
    if (!Array.isArray(cursor)) return { changed: false, value: cursor };
    if (seg.idx < 0 || seg.idx >= cursor.length) return { changed: false, value: cursor };
    const inner = setAtPath(cursor[seg.idx], segments, depth + 1, count);
    if (!inner.changed) return { changed: false, value: cursor };
    const next = cursor.slice();
    next[seg.idx] = inner.value;
    return { changed: true, value: next };
  }
  // 'key' segment.
  if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
    return { changed: false, value: cursor };
  }
  const obj = cursor as Record<string, unknown>;
  if (!(seg.name in obj)) return { changed: false, value: cursor };
  const inner = setAtPath(obj[seg.name], segments, depth + 1, count);
  if (!inner.changed) return { changed: false, value: cursor };
  return { changed: true, value: { ...obj, [seg.name]: inner.value } };
}

function repeatArray(arr: unknown[], count: number): unknown[] {
  if (count <= 0) return [];
  const template = arr[0];
  const out: unknown[] = [];
  for (let i = 0; i < count; i++) {
    // Shallow-clone object templates so consumers don't get aliased
    // references — preserves the "each item is its own object" invariant
    // most paginated responses assume.
    out.push(cloneShallow(template));
  }
  return out;
}

function cloneShallow(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice();
  return { ...(value as Record<string, unknown>) };
}
