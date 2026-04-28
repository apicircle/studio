// Extract values from an ExecutionResult per the request's `extractions`
// list and return a `Record<string, string>` keyed by the user-supplied
// `variable` names. Failures are non-fatal — a path that doesn't resolve
// produces an empty string and a warning so the rest of the chain still
// runs (matches v1's ResponseExtractor semantics).

import type { ContextExtraction } from '@apicircle/shared';
import type { ExecutionResult } from '../request/executeRequest';
import { readJsonPath } from '../assertions/runAssertions';

export interface ContextExtractionResult {
  extracted: Record<string, string>;
  warnings: string[];
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function readCookie(headers: Record<string, string>, name: string): string | undefined {
  // The browser strips Set-Cookie from cross-origin responses, but for
  // same-origin we may see it. Cookie *requests* are echoed too, so we
  // also check a `cookie` header for symmetry.
  const sources = [findHeader(headers, 'set-cookie'), findHeader(headers, 'cookie')].filter(
    (v): v is string => Boolean(v),
  );
  for (const raw of sources) {
    for (const part of raw.split(/;\s*/)) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      if (key === name) return part.slice(eq + 1);
    }
  }
  return undefined;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function extractContext(
  result: ExecutionResult,
  extractions: ReadonlyArray<ContextExtraction>,
): ContextExtractionResult {
  const extracted: Record<string, string> = {};
  const warnings: string[] = [];

  for (const config of extractions) {
    if (!config.enabled) continue;
    const variable = config.variable.trim();
    if (!variable) {
      warnings.push('Skipping extraction with empty variable name');
      continue;
    }

    let value: string | undefined;
    switch (config.source) {
      case 'status':
        value = result.status === null ? '' : String(result.status);
        break;
      case 'header':
        value = findHeader(result.headers, config.path.trim());
        if (value === undefined) {
          warnings.push(`Header "${config.path}" not found for "${variable}"`);
        }
        break;
      case 'cookie':
        value = readCookie(result.headers, config.path.trim());
        if (value === undefined) {
          warnings.push(`Cookie "${config.path}" not found for "${variable}"`);
        }
        break;
      case 'body': {
        if (result.body.length === 0) {
          warnings.push(`Body is empty — skipping "${variable}"`);
          break;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(result.body);
        } catch {
          warnings.push(`Body is not JSON — cannot extract "${variable}"`);
          break;
        }
        const found = readJsonPath(parsed, config.path);
        if (found === undefined) {
          warnings.push(`Body path "${config.path}" did not resolve for "${variable}"`);
        } else {
          value = stringify(found);
        }
        break;
      }
    }

    extracted[variable] = value ?? '';
  }

  return { extracted, warnings };
}
