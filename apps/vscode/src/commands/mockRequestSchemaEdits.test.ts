import { describe, it, expect } from 'vitest';
import { pathSlots, buildParamEntry, buildRequestSchemaBlock } from './mockRequestSchemaEdits';

describe('pathSlots', () => {
  it('returns an empty list for a slot-less path', () => {
    expect(pathSlots('/pets')).toEqual([]);
  });

  it('extracts a single placeholder', () => {
    expect(pathSlots('/pets/{id}')).toEqual(['id']);
  });

  it('extracts multiple placeholders in order, preserving duplicates', () => {
    expect(pathSlots('/users/{userId}/pets/{petId}')).toEqual(['userId', 'petId']);
    expect(pathSlots('/x/{a}/y/{a}')).toEqual(['a', 'a']);
  });

  it('ignores nested or malformed braces', () => {
    expect(pathSlots('/x/{a}{b}/z')).toEqual(['a', 'b']);
  });
});

describe('buildParamEntry', () => {
  it('emits id / name / typeHint / required / example with correct indentation', () => {
    const out = buildParamEntry(4, { name: 'userId', typeHint: 'uuid', required: true });
    const lines = out.split('\n');
    expect(lines[0].startsWith('    - id:')).toBe(true);
    expect(lines[1]).toMatch(/^ {6}name: 'userId'$/);
    expect(lines[2]).toMatch(/^ {6}typeHint: 'uuid'$/);
    expect(lines[3]).toMatch(/^ {6}required: true$/);
    expect(lines[4]).toMatch(/^ {6}example: ''$/);
  });

  it('writes `required: false` literally (not omitted)', () => {
    const out = buildParamEntry(2, { name: 'q', typeHint: 'string', required: false });
    expect(out).toContain('required: false');
  });

  it('mints a fresh id on each call', () => {
    const a = buildParamEntry(0, { name: 'a', typeHint: 'string', required: false });
    const b = buildParamEntry(0, { name: 'a', typeHint: 'string', required: false });
    const idA = a.split('\n')[0];
    const idB = b.split('\n')[0];
    expect(idA).not.toBe(idB);
  });
});

describe('buildRequestSchemaBlock', () => {
  it('seeds pathParams from slot names and leaves other lists empty', () => {
    const block = buildRequestSchemaBlock(['id']);
    expect(block).toContain('requestSchema:');
    expect(block).toContain('  pathParams:');
    expect(block).toContain("name: 'id'");
    expect(block).toContain('  queryParams: []');
    expect(block).toContain('  headers: []');
    expect(block).toContain('  cookies: []');
  });

  it('renders all lists as inline-empty when no slots are supplied', () => {
    const block = buildRequestSchemaBlock([]);
    expect(block).toContain('pathParams: []');
    expect(block).toContain('queryParams: []');
    expect(block).toContain('headers: []');
    expect(block).toContain('cookies: []');
  });

  it('handles multiple slots in order', () => {
    const block = buildRequestSchemaBlock(['userId', 'petId']);
    const userIdAt = block.indexOf("name: 'userId'");
    const petIdAt = block.indexOf("name: 'petId'");
    expect(userIdAt).toBeGreaterThan(-1);
    expect(petIdAt).toBeGreaterThan(userIdAt);
  });
});
