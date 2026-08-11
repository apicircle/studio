import { describe, expect, it } from 'vitest';
import type { Assertion } from '@apicircle/shared';
import { JSON_TYPES, opChangePatch, kindChangePatch } from './assertionOps';

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

  it('seeds an empty-object schema when switching to matches-schema (and keeps an existing schema)', () => {
    expect(opChangePatch(base, 'matches-schema')).toEqual({ op: 'matches-schema', expected: '{}' });
    expect(opChangePatch({ ...base, expected: '{"type":"object"}' }, 'matches-schema')).toEqual({
      op: 'matches-schema',
      expected: '{"type":"object"}',
    });
  });
});

describe('kindChangePatch', () => {
  it('switches to json-schema with the matches-schema op and a seeded schema', () => {
    expect(kindChangePatch(base, 'json-schema')).toEqual({
      kind: 'json-schema',
      op: 'matches-schema',
      expected: '{}',
    });
  });

  it('resets to an equals comparison when leaving json-schema', () => {
    const schema: Assertion = {
      id: 'a',
      kind: 'json-schema',
      op: 'matches-schema',
      expected: '{"type":"object"}',
    };
    expect(kindChangePatch(schema, 'status')).toEqual({
      kind: 'status',
      op: 'equals',
      expected: '',
    });
  });

  it('keeps the current op for a switch between non-schema kinds', () => {
    expect(kindChangePatch({ ...base, op: 'contains' }, 'header')).toEqual({ kind: 'header' });
  });
});
