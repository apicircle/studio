import { describe, expect, it } from 'vitest';
import type { Request as ApiRequest } from '@apicircle/shared';
import {
  mergeRequestOverride,
  computeRequestOverridePatch,
  isEmptyOverridePatch,
} from './requestOverride';

function req(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r1',
    name: 'List pets',
    folderId: null,
    method: 'GET',
    url: 'https://api/pets',
    headers: [],
    query: [],
    pathParams: [],
    cookies: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: 't',
    updatedAt: 't',
    ...over,
  } as ApiRequest;
}

describe('mergeRequestOverride', () => {
  it('layers only the patched fields, leaving identity fields from base', () => {
    const base = req();
    const merged = mergeRequestOverride(base, { url: 'https://mine/pets', method: 'POST' });
    expect(merged.url).toBe('https://mine/pets');
    expect(merged.method).toBe('POST');
    expect(merged.id).toBe('r1');
    expect(merged.name).toBe('List pets');
  });

  it('ignores non-overridable keys', () => {
    const merged = mergeRequestOverride(req(), { name: 'X' } as never);
    expect(merged.name).toBe('X');
  });
});

describe('computeRequestOverridePatch', () => {
  it('captures only diverging overridable fields', () => {
    const base = req();
    const effective = req({ url: 'https://mine/pets', name: 'My pets' });
    const patch = computeRequestOverridePatch(base, effective);
    expect(patch).toEqual({ url: 'https://mine/pets', name: 'My pets' });
  });

  it('returns {} when identical, and isEmptyOverridePatch agrees', () => {
    const patch = computeRequestOverridePatch(req(), req());
    expect(patch).toEqual({});
    expect(isEmptyOverridePatch(patch)).toBe(true);
  });

  it('round-trips: merge(base, compute(base, eff)) === eff (overridable fields)', () => {
    const base = req();
    const effective = req({ headers: [{ key: 'X', value: '1', enabled: true }], method: 'PUT' });
    const patch = computeRequestOverridePatch(base, effective);
    const merged = mergeRequestOverride(base, patch);
    expect(merged.headers).toEqual(effective.headers);
    expect(merged.method).toBe('PUT');
    expect(isEmptyOverridePatch(patch)).toBe(false);
  });
});
