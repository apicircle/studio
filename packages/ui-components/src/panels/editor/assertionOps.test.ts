import { describe, expect, it } from 'vitest';
import type { Assertion } from '@apicircle/shared';
import { JSON_TYPES, opChangePatch } from './assertionOps';

const base: Assertion = { id: 'a', kind: 'json-path', op: 'equals', target: '$.x', expected: 5 };

describe('opChangePatch', () => {
  it('clears the value when switching to exists', () => {
    expect(opChangePatch(base, 'exists')).toEqual({ op: 'exists', expected: '' });
  });

  it('seeds "string" for type when the current value is not a JSON type', () => {
    expect(opChangePatch(base, 'type')).toEqual({ op: 'type', expected: 'string' });
  });

  it('keeps an already-valid JSON type value when switching to type', () => {
    expect(opChangePatch({ ...base, expected: 'number' }, 'type')).toEqual({
      op: 'type',
      expected: 'number',
    });
  });

  it('keeps the value for a comparison op', () => {
    expect(opChangePatch(base, 'lt')).toEqual({ op: 'lt' });
  });

  it('lists the six JSON type names', () => {
    expect([...JSON_TYPES]).toEqual(['string', 'number', 'boolean', 'array', 'object', 'null']);
  });
});
