import { describe, expect, it } from 'vitest';
import { generateWorkingBranchName, slugify, validateBranchName } from './branchNames';

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with hyphens', () => {
    expect(slugify('Payments API')).toBe('payments-api');
    expect(slugify('My  Workspace!')).toBe('my-workspace');
  });

  it('strips combining accent marks', () => {
    expect(slugify('Résumé')).toBe('resume');
    expect(slugify('Café')).toBe('cafe');
  });

  it('drops leading and trailing hyphens', () => {
    expect(slugify('---hello---')).toBe('hello');
    expect(slugify('  spaces  ')).toBe('spaces');
  });

  it('falls back to "workspace" when input is empty after normalisation', () => {
    expect(slugify('')).toBe('workspace');
    expect(slugify('   ')).toBe('workspace');
    expect(slugify('!@#$%')).toBe('workspace');
  });
});

describe('generateWorkingBranchName', () => {
  it('produces apicircle/<slug>-<id>', () => {
    expect(
      generateWorkingBranchName({ workspaceName: 'Payments API', idGen: () => 'abc123' }),
    ).toBe('apicircle/payments-api-abc123');
  });

  it('uses the workspace fallback when the name is unhelpful', () => {
    expect(generateWorkingBranchName({ workspaceName: '   ', idGen: () => 'x1y2z3' })).toBe(
      'apicircle/workspace-x1y2z3',
    );
  });

  it('omitting idGen uses 6 random hex chars', () => {
    const name = generateWorkingBranchName({ workspaceName: 'Demo' });
    expect(name).toMatch(/^apicircle\/demo-[0-9a-f]{6}$/);
  });
});

describe('validateBranchName', () => {
  it('accepts the canonical auto-generated name', () => {
    expect(validateBranchName('apicircle/payments-a3f9c2')).toBeNull();
  });

  it('accepts simple slashed names', () => {
    expect(validateBranchName('feature/x')).toBeNull();
    expect(validateBranchName('main')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(validateBranchName('')).toMatch(/required/);
  });

  it('rejects whitespace, control chars, and Git-disallowed punctuation', () => {
    expect(validateBranchName('with space')).toMatch(/whitespace/);
    expect(validateBranchName('weird~name')).toMatch(/illegal/);
    expect(validateBranchName('weird^name')).toMatch(/illegal/);
    expect(validateBranchName('weird:name')).toMatch(/illegal/);
    expect(validateBranchName('weird?name')).toMatch(/illegal/);
    expect(validateBranchName('weird*name')).toMatch(/illegal/);
    expect(validateBranchName('weird[name')).toMatch(/illegal/);
  });

  it('rejects bad starts and ends', () => {
    expect(validateBranchName('-leading')).toMatch(/start/);
    expect(validateBranchName('/leading')).toMatch(/start/);
    expect(validateBranchName('trailing.')).toMatch(/end/);
    expect(validateBranchName('trailing.lock')).toMatch(/end/);
    expect(validateBranchName('trailing/')).toMatch(/end/);
  });

  it('rejects forbidden sequences', () => {
    expect(validateBranchName('a..b')).toMatch(/invalid sequence/);
    expect(validateBranchName('a//b')).toMatch(/invalid sequence/);
    expect(validateBranchName('a@{b')).toMatch(/invalid sequence/);
  });

  it('rejects names over 100 chars', () => {
    expect(validateBranchName('x'.repeat(101))).toMatch(/too long/);
  });
});
