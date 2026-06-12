import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { findSectionRange, readSectionType, __testHooks } from './switchRequestSection';

const { BODY_TYPES, AUTH_TYPES } = __testHooks;

// Minimal TextDocument mock backed by an array of lines. Covers the fields
// findSectionRange + the CodeLens scanner actually use: getText / lineAt /
// lineCount.
function makeDoc(lines: string[]): vscode.TextDocument {
  return {
    lineCount: lines.length,
    getText: () => lines.join('\n'),
    lineAt: (line: number) => ({
      text: lines[line] ?? '',
      range: {
        start: { line, character: 0 },
        end: { line, character: (lines[line] ?? '').length },
      },
    }),
  } as unknown as vscode.TextDocument;
}

describe('readSectionType', () => {
  it('returns the type field of a section', () => {
    const text = ['name: x', 'body:', '  type: json', '  content: "{}"'].join('\n');
    expect(readSectionType(text, 'body')).toBe('json');
  });

  it('handles quoted type values', () => {
    const text = ['auth:', '  type: "bearer"', '  token: ABC'].join('\n');
    expect(readSectionType(text, 'auth')).toBe('bearer');
  });

  it('stops at the next top-level key without leaking', () => {
    const text = ['body:', '  type: form-data', '  formRows: []', 'auth:', '  type: bearer'].join(
      '\n',
    );
    // Reading body must not pick up auth's type field.
    expect(readSectionType(text, 'body')).toBe('form-data');
    expect(readSectionType(text, 'auth')).toBe('bearer');
  });

  it('returns null when the section is absent', () => {
    expect(readSectionType('name: x\nmethod: GET', 'body')).toBeNull();
  });

  it('returns null when the section has no type: field', () => {
    expect(readSectionType('body:\n  content: raw', 'body')).toBeNull();
  });
});

describe('findSectionRange', () => {
  it('returns null when the section is missing', () => {
    expect(findSectionRange(makeDoc(['name: x', 'url: https://y']), 'body')).toBeNull();
  });

  it('covers the section header through the last indented child line', () => {
    const doc = makeDoc([
      'name: x',
      'body:',
      '  type: json',
      '  content: "{}"',
      'auth:',
      '  type: bearer',
    ]);
    const range = findSectionRange(doc, 'body');
    expect(range).not.toBeNull();
    expect(range!.start.line).toBe(1);
    // End anchors at line 4 (start of `auth:`) — replacement collapses the
    // body block cleanly, leaving the auth section intact.
    expect(range!.end.line).toBe(4);
  });

  it('extends to EOF when the section is the last block', () => {
    const doc = makeDoc(['name: x', 'auth:', '  type: bearer', '  token: ABC']);
    const range = findSectionRange(doc, 'auth');
    expect(range!.start.line).toBe(1);
    // Last line covered → range end is the trailing position of the last line.
    expect(range!.end.line).toBeGreaterThanOrEqual(3);
  });
});

describe('body type catalogue', () => {
  it('includes every BodyType discriminator from packages/shared types', () => {
    const expected = [
      'none',
      'json',
      'text',
      'xml',
      'form-data',
      'urlencoded',
      'binary',
      'graphql',
    ];
    const got = BODY_TYPES.map((b) => b.type);
    for (const t of expected) expect(got).toContain(t);
    expect(BODY_TYPES).toHaveLength(expected.length);
  });

  it('every body scaffold opens with `  type: <type>` so the round-trip is clean', () => {
    for (const def of BODY_TYPES) {
      expect(def.scaffoldLines[0]).toBe(`  type: ${def.type}`);
    }
  });
});

describe('auth type catalogue', () => {
  it('covers all 17 RequestAuth discriminators', () => {
    const expected = [
      'none',
      'inherit',
      'bearer',
      'basic',
      'api-key',
      'custom-header',
      'oauth2-client-credentials',
      'oauth2-auth-code',
      'oauth2-pkce',
      'oauth2-password',
      'oauth2-implicit',
      'oauth2-device',
      'aws-sigv4',
      'digest',
      'ntlm',
      'hawk',
      'jwt-bearer',
    ];
    const got = AUTH_TYPES.map((a) => a.type);
    for (const t of expected) expect(got).toContain(t);
    expect(AUTH_TYPES).toHaveLength(expected.length);
  });

  it('every auth scaffold opens with `  type: <type>`', () => {
    for (const def of AUTH_TYPES) {
      expect(def.scaffoldLines[0]).toBe(`  type: ${def.type}`);
    }
  });
});
