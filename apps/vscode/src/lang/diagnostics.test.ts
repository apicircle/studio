import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { Uri, DiagnosticSeverity } from '../../test/mocks/vscode';
import { computeDiagnostics } from './diagnostics';

function makeDoc(uri: unknown, text: string): vscode.TextDocument {
  const lines = text.split('\n');
  return {
    uri,
    getText: () => text,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const EP = (text: string) =>
  computeDiagnostics(makeDoc(Uri.parse('apicircle://x/mocks/m/ep.yaml'), text));

// The mock's DiagnosticSeverity enum is a distinct type from the one the
// provider's return type references, so compare via the numeric value.
const ERROR = Number(DiagnosticSeverity.Error);
const WARNING = Number(DiagnosticSeverity.Warning);
const sev = (d: vscode.Diagnostic): number => Number(d.severity);

describe('computeDiagnostics', () => {
  it('returns [] for non-apicircle documents', () => {
    expect(computeDiagnostics(makeDoc(Uri.parse('file:///x.yaml'), 'name: x'))).toEqual([]);
  });

  it('emits a blocking Error for an unknown top-level key, located on its row', () => {
    const text = ['name: X', 'method: GET', 'pathPattern: /x', 'defaultRespons: {}'].join('\n');
    const diags = EP(text);
    const error = diags.find((d) => sev(d) === ERROR);
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/Unknown field/);
    expect(error?.message).toMatch(/saving is blocked/);
    expect(error?.range.start.line).toBe(3); // the defaultRespons: row
  });

  it('emits a Warning (non-blocking) for a coercible issue', () => {
    const text = [
      'name: X',
      'method: GET',
      'pathPattern: /x',
      'requestValidation:',
      '  - id: v1',
      '    kind: not-a-real-kind',
      '    target: x',
      '    enabled: true',
      'defaultResponse:',
      '  status: 200',
      '  headers: []',
      '  body:',
      '    type: none',
      '    content: ""',
    ].join('\n');
    const diags = EP(text);
    expect(diags.some((d) => sev(d) === ERROR)).toBe(false);
    expect(diags.some((d) => sev(d) === WARNING)).toBe(true);
  });

  it('emits no diagnostics for a clean endpoint', () => {
    const text = [
      'name: X',
      'method: GET',
      'pathPattern: /x',
      'requestValidation: []',
      'responseRules: []',
      'defaultResponse:',
      '  status: 200',
      '  headers: []',
      '  body:',
      '    type: none',
      '    content: ""',
    ].join('\n');
    expect(EP(text)).toEqual([]);
  });

  describe('folder YAML', () => {
    const FY = (text: string) =>
      computeDiagnostics(makeDoc(Uri.parse('apicircle://x/folders/auth.yaml?id=fA'), text));

    it('emits no diagnostics for a valid folder', () => {
      expect(FY('name: API v2\nauth:\n  type: bearer\n  token: t\n')).toEqual([]);
    });

    it('flags a missing name as a save-blocking Error', () => {
      const diags = FY('auth:\n  type: none\n');
      const error = diags.find((d) => sev(d) === ERROR);
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/name/);
      expect(error?.message).toMatch(/saving is blocked/);
    });

    it('flags an unknown top-level key (typo guard) on its row', () => {
      const text = ['name: A', 'nam: B'].join('\n');
      const diags = FY(text);
      const error = diags.find((d) => sev(d) === ERROR);
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/Unknown field/);
      expect(error?.range.start.line).toBe(1);
    });

    it('flags a non-mapping auth section', () => {
      const diags = FY('name: A\nauth: invalid\n');
      expect(diags.find((d) => sev(d) === ERROR)?.message).toMatch(/mapping/);
    });
  });
});
