// Pre-validation evaluator. Runs every enabled rule on the inbound
// request; returns the first failing rule's `failResponse` (or null when
// all pass). Order is significant — the editor lets users reorder.

import type { MockEndpoint, MockResponseConfig, MockValidationRule } from '@apicircle/shared';
import type { RequestContext } from '../rules/evaluate';

export function evaluateValidation(
  endpoint: MockEndpoint,
  ctx: RequestContext,
): MockResponseConfig | null {
  for (const rule of endpoint.requestValidation) {
    if (!rule.enabled) continue;
    if (!rulePasses(rule, ctx)) {
      return rule.failResponse;
    }
  }
  return null;
}

function rulePasses(rule: MockValidationRule, ctx: RequestContext): boolean {
  switch (rule.kind) {
    case 'header-required': {
      const v = ctx.headers[rule.target.toLowerCase()];
      return v !== undefined && v !== '';
    }
    case 'header-equals': {
      const v = ctx.headers[rule.target.toLowerCase()];
      return v !== undefined && v === (rule.expected ?? '');
    }
    case 'header-matches': {
      const v = ctx.headers[rule.target.toLowerCase()];
      if (v === undefined) return false;
      return safeRegexTest(rule.expected, v);
    }
    case 'query-required': {
      const v = ctx.query[rule.target];
      return v !== undefined && v !== '';
    }
    case 'query-equals': {
      const v = ctx.query[rule.target];
      return v !== undefined && v === (rule.expected ?? '');
    }
    case 'query-matches': {
      const v = ctx.query[rule.target];
      if (v === undefined) return false;
      return safeRegexTest(rule.expected, v);
    }
    case 'cookie-required': {
      const v = ctx.cookies[rule.target];
      return v !== undefined && v !== '';
    }
    case 'body-required': {
      // Pass if either the parsed JSON body has at least one key/element
      // OR the raw text body is non-empty. Matches the user expectation
      // that any body — JSON or text — counts.
      if (ctx.bodyJson !== undefined && ctx.bodyJson !== null) {
        if (Array.isArray(ctx.bodyJson)) return ctx.bodyJson.length > 0;
        if (typeof ctx.bodyJson === 'object') {
          return Object.keys(ctx.bodyJson).length > 0;
        }
        return true;
      }
      return ctx.bodyText.length > 0;
    }
    case 'content-type-equals': {
      const ct = ctx.headers['content-type'] ?? '';
      // Strip parameters (`;charset=utf-8`) for the comparison so common
      // server-flavors of Content-Type still match a plain
      // `application/json` expectation.
      const main = ct.split(';')[0]?.trim().toLowerCase() ?? '';
      return main === (rule.expected ?? '').trim().toLowerCase();
    }
  }
}

function safeRegexTest(pattern: string | undefined, value: string): boolean {
  if (pattern === undefined) return false;
  try {
    const m = /^\/(.*)\/([a-z]*)$/.exec(pattern);
    const re = m ? new RegExp(m[1], m[2]) : new RegExp(pattern);
    return re.test(value);
  } catch {
    return false;
  }
}
