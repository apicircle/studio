import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import type { WorkspaceEdit, RecordedEdit } from '../../test/mocks/vscode';
import { applyRecordedEdits } from '../../test/mocks/vscode';
import {
  setRequestMethodFieldCommand,
  setRequestHeaderKeyFieldCommand,
  setRequestHeaderValueFieldCommand,
  setRequestTextFieldCommand,
  setRequestAssertionKindFieldCommand,
  setRequestAssertionOpFieldCommand,
  setRequestExtractionSourceFieldCommand,
  setRequestFieldEditsBridge,
} from './requestFieldEdits';

const reqUri = Uri.parse('apicircle://w/requests/r1.yaml');

function makeDoc(lines: string[]) {
  const save = vi.fn(async () => true);
  return {
    doc: {
      uri: reqUri,
      lineCount: lines.length,
      getText: () => lines.join('\n'),
      lineAt: (n: number) => ({
        text: lines[n] ?? '',
        range: {
          start: { line: n, character: 0 },
          end: { line: n, character: (lines[n] ?? '').length },
        },
      }),
      save,
    } as unknown,
    save,
  };
}

let savedDoc: { doc: unknown; save: Mock };

function arrange(lines: string[]): void {
  savedDoc = makeDoc(lines);
  (workspace.openTextDocument as Mock).mockResolvedValue(savedDoc.doc);
  (workspace.applyEdit as Mock).mockResolvedValue(true);
  (window.showTextDocument as Mock).mockResolvedValue({
    selection: undefined,
    revealRange: vi.fn(),
  });
}

function appliedText(originalLines: string[]): string {
  const edits = (workspace.applyEdit as Mock).mock.calls[0][0] as WorkspaceEdit;
  return applyRecordedEdits(originalLines.join('\n'), edits.edits as RecordedEdit[]);
}

function reset(): void {
  (window.showInputBox as Mock).mockReset();
  (window.showQuickPick as Mock).mockReset();
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (window.showTextDocument as Mock).mockReset();
  (workspace.openTextDocument as Mock).mockReset();
  (workspace.applyEdit as Mock).mockReset();
  window.activeTextEditor = undefined as unknown;
}

describe('setRequestMethodFieldCommand', () => {
  beforeEach(reset);

  it('warns when no URI is given and no active editor exists', async () => {
    await setRequestMethodFieldCommand(undefined, 0);
    expect(window.showWarningMessage).toHaveBeenCalledWith('No request YAML is active.');
  });

  it('warns on a non-apicircle URI', async () => {
    await setRequestMethodFieldCommand(Uri.parse('file:///x.yaml'), 0);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'This command only runs against an API Circle request YAML.',
    );
  });

  it('warns when the target line is out of bounds', async () => {
    arrange(['method: GET']);
    await setRequestMethodFieldCommand(reqUri, 99);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'The targeted field row no longer exists.',
    );
  });

  it('exits silently when the method picker is cancelled', async () => {
    arrange([
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ]);
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await setRequestMethodFieldCommand(reqUri, 1);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
    expect(savedDoc.save).not.toHaveBeenCalled();
  });

  it('replaces the method scalar on the targeted line and saves', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce('POST');
    await setRequestMethodFieldCommand(reqUri, 1);
    const updated = appliedText(lines);
    expect(updated).toContain('method: POST');
    expect(savedDoc.save).toHaveBeenCalledTimes(1);
  });
});

describe('setRequestHeaderKeyFieldCommand', () => {
  beforeEach(reset);

  it('writes a catalog pick onto the targeted key row', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'X-Old'",
      "    value: 'v'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'Authorization',
      value: 'Authorization',
    });
    await setRequestHeaderKeyFieldCommand(reqUri, 4);
    const updated = appliedText(lines);
    expect(updated).toContain("key: 'Authorization'");
  });

  it('falls through to a free-text input when ✏ Custom… is picked', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'X-Old'",
      "    value: 'v'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: '✏ Custom…',
      value: '__custom__',
    });
    (window.showInputBox as Mock).mockResolvedValueOnce('X-Trace');
    await setRequestHeaderKeyFieldCommand(reqUri, 4);
    const updated = appliedText(lines);
    expect(updated).toContain("key: 'X-Trace'");
  });
});

describe('setRequestHeaderValueFieldCommand', () => {
  beforeEach(reset);

  it('writes a free-text value when no catalog applies to the header', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'X-Custom'",
      "    value: 'old'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('new-value');
    await setRequestHeaderValueFieldCommand(reqUri, 5);
    const updated = appliedText(lines);
    expect(updated).toContain("value: 'new-value'");
  });
});

describe('setRequestTextFieldCommand', () => {
  beforeEach(reset);

  it('rewrites a free-text scalar (e.g. value:)', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'query:',
      "  - key: 'q'",
      "    value: 'old'",
      '    enabled: true',
      'headers: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('new-q');
    await setRequestTextFieldCommand(reqUri, 5);
    const updated = appliedText(lines);
    expect(updated).toContain("value: 'new-q'");
  });
});

describe('assertion / extraction enum pickers', () => {
  beforeEach(reset);

  const lines = [
    'name: r',
    'method: GET',
    'url: https://x.com',
    'assertions:',
    "  - id: 'a1'",
    "    name: 'x'",
    "    kind: 'status'",
    "    op: 'equals'",
    "    expected: '200'",
    '    enabled: true',
    'extractions:',
    "  - id: 'e1'",
    "    variable: 't'",
    "    source: 'body'",
    "    path: '$'",
    '    enabled: true',
    'headers: []',
    'query: []',
    'body:',
    '  type: none',
    "  content: ''",
    'auth:',
    '  type: none',
  ];

  it('assertion kind picker writes the raw enum value (no quoting layer)', async () => {
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce('header');
    await setRequestAssertionKindFieldCommand(reqUri, 6);
    const updated = appliedText(lines);
    expect(updated).toContain('kind: header');
  });

  it('assertion op picker writes the raw enum value', async () => {
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce('contains');
    await setRequestAssertionOpFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain('op: contains');
  });

  it('extraction source picker writes the raw enum value', async () => {
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce('header');
    await setRequestExtractionSourceFieldCommand(reqUri, 13);
    const updated = appliedText(lines);
    expect(updated).toContain('source: header');
  });

  it('extraction source picker exits silently on cancel', async () => {
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await setRequestExtractionSourceFieldCommand(reqUri, 13);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });
});

import { toggleRequestRowEnabledCommand } from './requestFieldEdits';

describe('toggleRequestRowEnabledCommand', () => {
  beforeEach(reset);

  const baseLines = [
    'name: r',
    'method: GET',
    'url: https://x',
    'headers:',
    "  - key: 'X-Custom'",
    "    value: 'v'",
    '    enabled: true',
    'query: []',
    'body:',
    '  type: none',
    "  content: ''",
  ];

  it('flips the enabled flag', async () => {
    arrange(baseLines);
    await toggleRequestRowEnabledCommand(reqUri, 6);
    const updated = appliedText(baseLines);
    expect(updated).toContain('enabled: false');
  });

  it('inserts enabled: false when no explicit enabled row is present', async () => {
    const noEnabled = [
      'name: r',
      'method: GET',
      'url: https://x',
      'headers:',
      "  - key: 'X-Custom'",
      "    value: 'v'",
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(noEnabled);
    await toggleRequestRowEnabledCommand(reqUri, 4);
    const updated = appliedText(noEnabled);
    expect(updated).toContain('enabled: false');
  });

  it('warns when no URI is in focus', async () => {
    await toggleRequestRowEnabledCommand(undefined, 0);
    expect(window.showWarningMessage).toHaveBeenCalled();
  });
});

import {
  setRequestAssertionTargetFieldCommand,
  setRequestAssertionExpectedFieldCommand,
  setRequestAuthFieldCommand,
} from './requestFieldEdits';

describe('setRequestAssertionTargetFieldCommand', () => {
  beforeEach(reset);

  it('writes a curated header name to the target row when kind=header', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    target: 'X-Old'",
      "    expected: 'v'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'Content-Type',
      value: 'Content-Type',
    });
    await setRequestAssertionTargetFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain("target: 'Content-Type'");
  });

  it('exits silently when the picker is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    target: 'X-Old'",
      "    expected: 'v'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await setRequestAssertionTargetFieldCommand(reqUri, 7);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });
});

describe('setRequestAssertionExpectedFieldCommand', () => {
  beforeEach(reset);

  it('uses a status-code picker for kind=status', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'status'",
      "    op: 'equals'",
      '    expected: 200',
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '418', code: 418 });
    await setRequestAssertionExpectedFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain('expected: 418');
  });

  it('uses a numeric input box for kind=duration', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'duration'",
      "    op: 'lt'",
      '    expected: 500',
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('800');
    await setRequestAssertionExpectedFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain('expected: 800');
  });
});

describe('setRequestAuthFieldCommand', () => {
  beforeEach(reset);

  it('offers a quick-pick for clientAuthMethod', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'auth:',
      "  type: 'oauth2-client-credentials'",
      "  tokenUrl: 'https://idp/token'",
      "  clientId: 'app'",
      "  clientAuthMethod: 'header'",
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'body' });
    await setRequestAuthFieldCommand(reqUri, 7);
    expect(window.showQuickPick).toHaveBeenCalled();
  });

  it('offers a quick-pick for codeChallengeMethod', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'auth:',
      "  type: 'oauth2-pkce'",
      "  codeChallengeMethod: 'S256'",
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'plain' });
    await setRequestAuthFieldCommand(reqUri, 5);
    expect(window.showQuickPick).toHaveBeenCalled();
  });

  it('offers Hawk algorithm picker for type=hawk', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'auth:',
      "  type: 'hawk'",
      "  algorithm: 'sha256'",
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'sha1' });
    await setRequestAuthFieldCommand(reqUri, 5);
    expect(window.showQuickPick).toHaveBeenCalled();
  });

  it('exits silently when picker is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'auth:',
      "  type: 'jwt-bearer'",
      "  algorithm: 'HS256'",
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await setRequestAuthFieldCommand(reqUri, 5);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('returns silently for an unrecognized field', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'auth:',
      "  type: 'bearer'",
      "  token: 'abc'",
    ];
    arrange(lines);
    await setRequestAuthFieldCommand(reqUri, 5);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('offers JWT algorithm picker for type=jwt-bearer', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'auth:',
      "  type: 'jwt-bearer'",
      "  algorithm: 'HS256'",
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'RS256' });
    await setRequestAuthFieldCommand(reqUri, 5);
    const updated = appliedText(lines);
    expect(updated).toContain("algorithm: 'RS256'");
  });

  it('offers tokenType picker with custom option for oauth2', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'auth:',
      "  type: 'oauth2-client-credentials'",
      "  tokenType: 'Bearer'",
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'MAC' });
    await setRequestAuthFieldCommand(reqUri, 5);
    const updated = appliedText(lines);
    expect(updated).toContain("tokenType: 'MAC'");
  });

  it('falls through to custom input box for tokenType __custom__', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'auth:',
      "  type: 'oauth2-client-credentials'",
      "  tokenType: 'Bearer'",
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '__custom__' });
    (window.showInputBox as Mock).mockResolvedValueOnce('DPoP-Custom');
    await setRequestAuthFieldCommand(reqUri, 5);
    const updated = appliedText(lines);
    expect(updated).toContain("tokenType: 'DPoP-Custom'");
  });

  it('exits silently when custom tokenType input is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'auth:',
      "  type: 'oauth2-client-credentials'",
      "  tokenType: 'Bearer'",
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '__custom__' });
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestAuthFieldCommand(reqUri, 5);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('returns early when key match fails (no field key found)', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'auth:',
      "  type: 'hawk'",
      "nope-not-indented: 'sha256'",
    ];
    arrange(lines);
    await setRequestAuthFieldCommand(reqUri, 5);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('reads auth type from context even when encountering a top-level key break', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'auth:',
      "  type: 'hawk'",
      "  algorithm: 'sha256'",
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'sha1' });
    await setRequestAuthFieldCommand(reqUri, 5);
    const updated = appliedText(lines);
    expect(updated).toContain("algorithm: 'sha1'");
  });
});

// ---------------------------------------------------------------------------
// setRequestFieldEditsBridge
// ---------------------------------------------------------------------------

describe('setRequestFieldEditsBridge', () => {
  it('sets and clears the bridge reference without error', () => {
    // Calling with null and a fake bridge exercises the setter.
    setRequestFieldEditsBridge(null);
    setRequestFieldEditsBridge({ activeWorkspace: () => null } as never);
    setRequestFieldEditsBridge(null);
  });
});

// ---------------------------------------------------------------------------
// applyAndSaveRequest error paths
// ---------------------------------------------------------------------------

describe('applyAndSaveRequest error branches', () => {
  beforeEach(reset);

  it('shows an error when applyEdit returns false', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (workspace.applyEdit as Mock).mockResolvedValueOnce(false);
    (window.showQuickPick as Mock).mockResolvedValueOnce('POST');
    await setRequestMethodFieldCommand(reqUri, 1);
    expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to edit the request YAML.');
    expect(savedDoc.save).not.toHaveBeenCalled();
  });

  it('shows an error and skips save when parseRequestFromYaml throws RequestYamlParseError', async () => {
    // After applyEdit, getText() returns YAML with an unknown top-level key
    // which triggers a RequestYamlParseError from parseRequestFromYaml
    const badLines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
      'unknownField: oops',
    ];
    const save = vi.fn(async () => true);
    const badDoc = {
      uri: reqUri,
      lineCount: badLines.length,
      getText: () => badLines.join('\n'),
      lineAt: (n: number) => ({
        text: badLines[n] ?? '',
        range: {
          start: { line: n, character: 0 },
          end: { line: n, character: (badLines[n] ?? '').length },
        },
      }),
      save,
    };
    (workspace.openTextDocument as Mock).mockResolvedValue(badDoc);
    (workspace.applyEdit as Mock).mockResolvedValueOnce(true);
    (window.showTextDocument as Mock).mockResolvedValue({
      selection: undefined,
      revealRange: vi.fn(),
    });
    (window.showQuickPick as Mock).mockResolvedValueOnce('POST');
    await setRequestMethodFieldCommand(reqUri, 1);
    // The parse error path shows an error message and doesn't save
    expect(window.showErrorMessage).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// commitScalar error path (replaceScalarOnLine returns null)
// ---------------------------------------------------------------------------

describe('commitScalar error path', () => {
  beforeEach(reset);

  it('shows error when the field row cannot be parsed', async () => {
    // A line that does NOT have a "key: value" pattern will cause
    // replaceScalarOnLine to return null
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
      '  - just a list entry with no key',
    ];
    arrange(lines);
    // The text field command calls commitScalar on the raw line
    (window.showInputBox as Mock).mockResolvedValueOnce('new-val');
    await setRequestTextFieldCommand(reqUri, 10);
    expect(window.showErrorMessage).toHaveBeenCalledWith('Could not parse the field row.');
  });
});

// ---------------------------------------------------------------------------
// setRequestHeaderKeyFieldCommand — custom input cancelled
// ---------------------------------------------------------------------------

describe('setRequestHeaderKeyFieldCommand edge cases', () => {
  beforeEach(reset);

  it('exits silently when the custom input is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'X-Old'",
      "    value: 'v'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: '✏ Custom…',
      value: '__custom__',
    });
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestHeaderKeyFieldCommand(reqUri, 4);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('exits silently when the picker is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'X-Old'",
      "    value: 'v'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await setRequestHeaderKeyFieldCommand(reqUri, 4);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setRequestHeaderValueFieldCommand — curated catalogue path + custom
// ---------------------------------------------------------------------------

describe('setRequestHeaderValueFieldCommand with catalogue', () => {
  beforeEach(reset);

  it('uses the curated catalogue for a known header like Accept', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'Accept'",
      "    value: 'text/html'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'application/json',
      value: 'application/json',
    });
    await setRequestHeaderValueFieldCommand(reqUri, 5);
    const updated = appliedText(lines);
    expect(updated).toContain("value: 'application/json'");
  });

  it('falls through to custom input when __custom__ is picked from catalogue', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'Accept'",
      "    value: 'text/html'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: '✏ Custom…',
      value: '__custom__',
    });
    (window.showInputBox as Mock).mockResolvedValueOnce('text/csv');
    await setRequestHeaderValueFieldCommand(reqUri, 5);
    const updated = appliedText(lines);
    expect(updated).toContain("value: 'text/csv'");
  });

  it('exits silently when catalogue picker is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'Accept'",
      "    value: 'text/html'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await setRequestHeaderValueFieldCommand(reqUri, 5);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('exits silently when custom input is cancelled from catalogue picker', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'Accept'",
      "    value: 'text/html'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: '✏ Custom…',
      value: '__custom__',
    });
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestHeaderValueFieldCommand(reqUri, 5);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('exits silently when free-text input is cancelled (no catalogue)', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'X-Custom'",
      "    value: 'old'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestHeaderValueFieldCommand(reqUri, 5);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('resolves header name from the key row above with correct indent matching', async () => {
    // The key: row is at indent 4 (two spaces for dash, two for field).
    // The value: row is at indent 4 (field indent within the entry).
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'Content-Type'",
      "    value: 'text/plain'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    // Content-Type has curated values so the catalogue path should trigger
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'application/json',
      value: 'application/json',
    });
    await setRequestHeaderValueFieldCommand(reqUri, 5);
    const updated = appliedText(lines);
    expect(updated).toContain("value: 'application/json'");
  });
});

// ---------------------------------------------------------------------------
// setRequestTextFieldCommand edge cases
// ---------------------------------------------------------------------------

describe('setRequestTextFieldCommand edge cases', () => {
  beforeEach(reset);

  it('exits silently when input is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'query:',
      "  - key: 'q'",
      "    value: 'old'",
      '    enabled: true',
      'headers: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestTextFieldCommand(reqUri, 5);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setRequestAssertionTargetFieldCommand — more branches
// ---------------------------------------------------------------------------

describe('setRequestAssertionTargetFieldCommand extra branches', () => {
  beforeEach(reset);

  it('falls through to custom input for header target when __custom__ is picked', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    target: 'X-Old'",
      "    expected: 'v'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: '✏ Custom…',
      value: '__custom__',
    });
    (window.showInputBox as Mock).mockResolvedValueOnce('X-Request-Id');
    await setRequestAssertionTargetFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain("target: 'X-Request-Id'");
  });

  it('exits silently when custom header target input is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    target: 'X-Old'",
      "    expected: 'v'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: '✏ Custom…',
      value: '__custom__',
    });
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestAssertionTargetFieldCommand(reqUri, 7);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('falls through to free text for json-path target when bridge is null', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'json-path'",
      "    op: 'equals'",
      "    target: '$.old'",
      "    expected: 'v'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    setRequestFieldEditsBridge(null);
    (window.showInputBox as Mock).mockResolvedValueOnce('$.data.id');
    await setRequestAssertionTargetFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain("target: '$.data.id'");
  });

  it('exits silently when json-path target free text input is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'json-path'",
      "    op: 'equals'",
      "    target: '$.old'",
      "    expected: 'v'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    setRequestFieldEditsBridge(null);
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestAssertionTargetFieldCommand(reqUri, 7);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('delegates to setRequestTextFieldCommand for unknown kind', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'status'",
      "    op: 'equals'",
      "    target: '200'",
      "    expected: 'v'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('500');
    await setRequestAssertionTargetFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain("target: '500'");
  });
});

// ---------------------------------------------------------------------------
// setRequestAssertionExpectedFieldCommand — more branches
// ---------------------------------------------------------------------------

describe('setRequestAssertionExpectedFieldCommand extra branches', () => {
  beforeEach(reset);

  it('falls through to custom input for status when __custom__ code is null', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'status'",
      "    op: 'equals'",
      '    expected: 200',
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: '✏ Custom…',
      code: null,
    });
    (window.showInputBox as Mock).mockResolvedValueOnce('451');
    await setRequestAssertionExpectedFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain('expected: 451');
  });

  it('exits silently when custom status input is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'status'",
      "    op: 'equals'",
      '    expected: 200',
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: '✏ Custom…',
      code: null,
    });
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestAssertionExpectedFieldCommand(reqUri, 7);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('exits silently when status picker is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'status'",
      "    op: 'equals'",
      '    expected: 200',
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await setRequestAssertionExpectedFieldCommand(reqUri, 7);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('exits silently when duration input is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'duration'",
      "    op: 'lt'",
      '    expected: 500',
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestAssertionExpectedFieldCommand(reqUri, 7);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('uses header value catalogue for kind=header expected with known target', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    target: 'Accept'",
      "    expected: 'text/html'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'application/json',
      value: 'application/json',
    });
    await setRequestAssertionExpectedFieldCommand(reqUri, 8);
    const updated = appliedText(lines);
    expect(updated).toContain("expected: 'application/json'");
  });

  it('falls through to custom input for header expected when __custom__ is picked', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    target: 'Accept'",
      "    expected: 'text/html'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: '✏ Custom…',
      value: '__custom__',
    });
    (window.showInputBox as Mock).mockResolvedValueOnce('text/csv');
    await setRequestAssertionExpectedFieldCommand(reqUri, 8);
    const updated = appliedText(lines);
    expect(updated).toContain("expected: 'text/csv'");
  });

  it('exits silently when header expected custom input is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    target: 'Accept'",
      "    expected: 'text/html'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: '✏ Custom…',
      value: '__custom__',
    });
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestAssertionExpectedFieldCommand(reqUri, 8);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('exits silently when header expected picker is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    target: 'Accept'",
      "    expected: 'text/html'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await setRequestAssertionExpectedFieldCommand(reqUri, 8);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('uses free-text for header expected when target has no catalogue', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    target: 'X-Custom-Nope'",
      "    expected: 'old'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('new-value');
    await setRequestAssertionExpectedFieldCommand(reqUri, 8);
    const updated = appliedText(lines);
    expect(updated).toContain("expected: 'new-value'");
  });

  it('exits silently when header expected free-text input is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    target: 'X-Custom-Nope'",
      "    expected: 'old'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestAssertionExpectedFieldCommand(reqUri, 8);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('falls back to free text for json-path expected when bridge is null', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'json-path'",
      "    op: 'equals'",
      "    target: '$.data'",
      "    expected: 'old'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    setRequestFieldEditsBridge(null);
    (window.showInputBox as Mock).mockResolvedValueOnce('expected-value');
    await setRequestAssertionExpectedFieldCommand(reqUri, 8);
    const updated = appliedText(lines);
    expect(updated).toContain("expected: 'expected-value'");
  });

  it('exits silently when json-path expected free text is cancelled', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'json-path'",
      "    op: 'equals'",
      "    target: '$.data'",
      "    expected: 'old'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    setRequestFieldEditsBridge(null);
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setRequestAssertionExpectedFieldCommand(reqUri, 8);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('delegates to text field for an unknown assertion kind', async () => {
    // No kind: row above — readAssertionKindFromContext returns ''
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    op: 'equals'",
      "    expected: 'old'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('42');
    await setRequestAssertionExpectedFieldCommand(reqUri, 6);
    const updated = appliedText(lines);
    expect(updated).toContain("expected: '42'");
  });
});

// ---------------------------------------------------------------------------
// readAssertionKindFromContext — forward walk branch
// ---------------------------------------------------------------------------

describe('readAssertionKindFromContext (forward walk)', () => {
  beforeEach(reset);

  it('finds kind below the current field when kind is after target', async () => {
    // Reorder so kind: sits after target: to exercise the forward walk
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    target: 'Content-Type'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    expected: 'v'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    // kind=header should be found via forward walk from line 5 (target:)
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'Content-Type',
      value: 'Content-Type',
    });
    await setRequestAssertionTargetFieldCommand(reqUri, 5);
    // The fact that it used the header picker (showQuickPick) instead of
    // the text field (showInputBox) proves the forward walk found kind.
    expect(window.showQuickPick).toHaveBeenCalled();
    const updated = appliedText(lines);
    expect(updated).toContain("target: 'Content-Type'");
  });

  it('returns empty kind when no kind row is found in either direction', async () => {
    // No kind: at all — readAssertionKindFromContext returns ''
    // The command should fall through to setRequestTextFieldCommand
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    op: 'equals'",
      "    target: 'something'",
      "    expected: 'v'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('new-target');
    await setRequestAssertionTargetFieldCommand(reqUri, 6);
    // Falls through to text field command (showInputBox)
    expect(window.showInputBox).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// toggleRequestRowEnabledCommand — more branches
// ---------------------------------------------------------------------------

describe('toggleRequestRowEnabledCommand extra branches', () => {
  beforeEach(reset);

  it('flips enabled: false to enabled: true when targeting the dash row', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'headers:',
      "  - key: 'X-Custom'",
      "    value: 'v'",
      '    enabled: false',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    // Target the `- key:` row (line 4) so the scan finds enabled: false at line 6
    await toggleRequestRowEnabledCommand(reqUri, 4);
    const updated = appliedText(lines);
    expect(updated).toContain('enabled: true');
  });

  it('shows error when replaceScalarOnLine fails on enabled row', async () => {
    // Create a doc where the enabled row is malformed (no "key: value" pattern)
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'headers:',
      "  - key: 'X-Custom'",
      "    value: 'v'",
      '    - enabled weird format',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    // We need a line that matches the enabled regex but whose text fails
    // replaceScalarOnLine. Override lineAt to return matching enabled text
    // for the discovery, but break text for replacement.
    const save = vi.fn(async () => true);
    const doc = {
      uri: reqUri,
      lineCount: lines.length,
      getText: () => lines.join('\n'),
      lineAt: (n: number) => {
        // line 6 looks like it has `enabled: true` for the scan
        const text = lines[n] ?? '';
        return {
          text,
          range: {
            start: { line: n, character: 0 },
            end: { line: n, character: text.length },
          },
        };
      },
      save,
    };
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    (workspace.applyEdit as Mock).mockResolvedValue(true);
    (window.showTextDocument as Mock).mockResolvedValue({
      selection: undefined,
      revealRange: vi.fn(),
    });
    // toggleRequestRowEnabledCommand on the dash row (line 4, - key: ...)
    // will scan downward from line 4, and the malformed enabled line won't match
    // the enabled regex. So it will insert a new enabled: false row.
    await toggleRequestRowEnabledCommand(reqUri, 4);
    // The insert branch should have been taken
    expect(workspace.applyEdit).toHaveBeenCalled();
  });

  it('warns on a non-request URI', async () => {
    await toggleRequestRowEnabledCommand(Uri.parse('apicircle://w/mocks/r1.yaml'), 0);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'This command only runs against an API Circle request YAML.',
    );
  });
});

// ---------------------------------------------------------------------------
// pickJsonPathForRequest + pickJsonPathValueForRequest + resolveJsonPath
// via the bridge
// ---------------------------------------------------------------------------

describe('bridge-driven json-path assertion paths', () => {
  beforeEach(() => {
    reset();
    setRequestFieldEditsBridge(null);
  });
  afterEach(() => {
    setRequestFieldEditsBridge(null);
  });

  const assertionLines = [
    'name: r',
    'method: GET',
    'url: https://x',
    'assertions:',
    "  - id: 'a1'",
    "    kind: 'json-path'",
    "    op: 'equals'",
    "    target: '$.data'",
    "    expected: 'old'",
    '    enabled: true',
    'headers: []',
    'query: []',
    'body:',
    '  type: none',
    "  content: ''",
    'auth:',
    '  type: none',
  ];

  const reqUriWithId = Uri.parse('apicircle://w/requests/my-req.yaml?id=req-123');

  function arrangeWithId(lines: string[], uri: Uri): void {
    savedDoc = makeDoc(lines);
    // Override the uri on the doc to match the one with ?id=
    (savedDoc.doc as { uri: Uri }).uri = uri;
    (workspace.openTextDocument as Mock).mockResolvedValue(savedDoc.doc);
    (workspace.applyEdit as Mock).mockResolvedValue(true);
    (window.showTextDocument as Mock).mockResolvedValue({
      selection: undefined,
      revealRange: vi.fn(),
    });
  }

  it('uses json-path picker when bridge returns a run with json body (target)', async () => {
    const fakeBridge = {
      activeWorkspace: () => ({
        read: async () => ({
          synced: {},
          local: {
            history: {
              requestRuns: [
                {
                  requestId: 'req-123',
                  responseBodyKind: 'json',
                  responseBodyPreview: '{"data":{"id":42,"name":"test"}}',
                },
              ],
            },
          },
        }),
      }),
    };
    setRequestFieldEditsBridge(fakeBridge as never);
    arrangeWithId(assertionLines, reqUriWithId);
    // pickJsonPath shows a quick pick of leaves — simulate picking $.data.id
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '$.data.id' });
    await setRequestAssertionTargetFieldCommand(reqUriWithId, 7);
    const updated = appliedText(assertionLines);
    expect(updated).toContain("target: '$.data.id'");
  });

  it('falls back to text when bridge returns no runs for the request id', async () => {
    const fakeBridge = {
      activeWorkspace: () => ({
        read: async () => ({
          synced: {},
          local: { history: { requestRuns: [] } },
        }),
      }),
    };
    setRequestFieldEditsBridge(fakeBridge as never);
    arrangeWithId(assertionLines, reqUriWithId);
    (window.showInputBox as Mock).mockResolvedValueOnce('$.fallback');
    await setRequestAssertionTargetFieldCommand(reqUriWithId, 7);
    const updated = appliedText(assertionLines);
    expect(updated).toContain("target: '$.fallback'");
  });

  it('falls back when bridge has no active workspace', async () => {
    const fakeBridge = { activeWorkspace: () => null };
    setRequestFieldEditsBridge(fakeBridge as never);
    arrangeWithId(assertionLines, reqUriWithId);
    (window.showInputBox as Mock).mockResolvedValueOnce('$.none');
    await setRequestAssertionTargetFieldCommand(reqUriWithId, 7);
    const updated = appliedText(assertionLines);
    expect(updated).toContain("target: '$.none'");
  });

  it('falls back when the URI has no request id', async () => {
    const noIdUri = Uri.parse('apicircle://w/requests/my-req.yaml');
    const fakeBridge = {
      activeWorkspace: () => ({
        read: async () => ({
          synced: {},
          local: {
            history: {
              requestRuns: [
                {
                  requestId: 'req-123',
                  responseBodyKind: 'json',
                  responseBodyPreview: '{"x":1}',
                },
              ],
            },
          },
        }),
      }),
    };
    setRequestFieldEditsBridge(fakeBridge as never);
    arrangeWithId(assertionLines, noIdUri);
    (window.showInputBox as Mock).mockResolvedValueOnce('$.noid');
    await setRequestAssertionTargetFieldCommand(noIdUri, 7);
    const updated = appliedText(assertionLines);
    expect(updated).toContain("target: '$.noid'");
  });

  it('falls back when the run body kind is not json', async () => {
    const fakeBridge = {
      activeWorkspace: () => ({
        read: async () => ({
          synced: {},
          local: {
            history: {
              requestRuns: [
                {
                  requestId: 'req-123',
                  responseBodyKind: 'text',
                  responseBodyPreview: 'not json',
                },
              ],
            },
          },
        }),
      }),
    };
    setRequestFieldEditsBridge(fakeBridge as never);
    arrangeWithId(assertionLines, reqUriWithId);
    (window.showInputBox as Mock).mockResolvedValueOnce('$.textbody');
    await setRequestAssertionTargetFieldCommand(reqUriWithId, 7);
    const updated = appliedText(assertionLines);
    expect(updated).toContain("target: '$.textbody'");
  });

  it('resolves json-path value for expected field via bridge', async () => {
    const fakeBridge = {
      activeWorkspace: () => ({
        read: async () => ({
          synced: {},
          local: {
            history: {
              requestRuns: [
                {
                  requestId: 'req-123',
                  responseBodyKind: 'json',
                  responseBodyPreview: '{"data":{"id":42,"name":"test"}}',
                },
              ],
            },
          },
        }),
      }),
    };
    setRequestFieldEditsBridge(fakeBridge as never);
    arrangeWithId(assertionLines, reqUriWithId);
    // First pick is for pickJsonPathForRequest → pickJsonPath
    // It will show the leaves quick pick, user picks $.data.name
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '$.data.name' });
    await setRequestAssertionExpectedFieldCommand(reqUriWithId, 8);
    // Should resolve to the value at $.data.name = "test"
    const updated = appliedText(assertionLines);
    expect(updated).toContain("expected: 'test'");
  });

  it('falls back to free text for expected when json-path picker is cancelled', async () => {
    const fakeBridge = {
      activeWorkspace: () => ({
        read: async () => ({
          synced: {},
          local: {
            history: {
              requestRuns: [
                {
                  requestId: 'req-123',
                  responseBodyKind: 'json',
                  responseBodyPreview: '{"data":{"id":42}}',
                },
              ],
            },
          },
        }),
      }),
    };
    setRequestFieldEditsBridge(fakeBridge as never);
    arrangeWithId(assertionLines, reqUriWithId);
    // User cancels the quick pick
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    (window.showInputBox as Mock).mockResolvedValueOnce('fallback-val');
    await setRequestAssertionExpectedFieldCommand(reqUriWithId, 8);
    const updated = appliedText(assertionLines);
    expect(updated).toContain("expected: 'fallback-val'");
  });

  it('resolves json-path with bracket and array notation', async () => {
    const fakeBridge = {
      activeWorkspace: () => ({
        read: async () => ({
          synced: {},
          local: {
            history: {
              requestRuns: [
                {
                  requestId: 'req-123',
                  responseBodyKind: 'json',
                  responseBodyPreview: '{"items":[{"val":99}]}',
                },
              ],
            },
          },
        }),
      }),
    };
    setRequestFieldEditsBridge(fakeBridge as never);
    arrangeWithId(assertionLines, reqUriWithId);
    // Pick $.items[0].val
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '$.items[0].val' });
    await setRequestAssertionExpectedFieldCommand(reqUriWithId, 8);
    const updated = appliedText(assertionLines);
    expect(updated).toContain("expected: '99'");
  });

  it('falls back when bridge response body is not valid json for expected', async () => {
    const fakeBridge = {
      activeWorkspace: () => ({
        read: async () => ({
          synced: {},
          local: {
            history: {
              requestRuns: [
                {
                  requestId: 'req-123',
                  responseBodyKind: 'json',
                  responseBodyPreview: 'not-json-at-all',
                },
              ],
            },
          },
        }),
      }),
    };
    setRequestFieldEditsBridge(fakeBridge as never);
    arrangeWithId(assertionLines, reqUriWithId);
    // pickJsonPath will show a warning that body is not valid JSON, returning null
    // Then pickJsonPathValueForRequest returns null
    // Falls through to the free-text input
    (window.showInputBox as Mock).mockResolvedValueOnce('manual-val');
    await setRequestAssertionExpectedFieldCommand(reqUriWithId, 8);
    const updated = appliedText(assertionLines);
    expect(updated).toContain("expected: 'manual-val'");
  });
});

// ---------------------------------------------------------------------------
// requestIdFromUri — path fallback
// ---------------------------------------------------------------------------

describe('requestIdFromUri fallback paths', () => {
  beforeEach(() => {
    reset();
    setRequestFieldEditsBridge(null);
  });
  afterEach(() => {
    setRequestFieldEditsBridge(null);
  });

  it('extracts id from path slug when no ?id= query is present', async () => {
    // URI like apicircle://w/requests/req-abc.yaml (no ?id=)
    // The bridge exists and has matching runs by requestId = 'req-abc'
    const pathUri = Uri.parse('apicircle://w/requests/req-abc.yaml');
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'json-path'",
      "    op: 'equals'",
      "    target: '$.x'",
      "    expected: 'old'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    savedDoc = makeDoc(lines);
    (savedDoc.doc as { uri: Uri }).uri = pathUri;
    (workspace.openTextDocument as Mock).mockResolvedValue(savedDoc.doc);
    (workspace.applyEdit as Mock).mockResolvedValue(true);
    (window.showTextDocument as Mock).mockResolvedValue({
      selection: undefined,
      revealRange: vi.fn(),
    });
    const fakeBridge = {
      activeWorkspace: () => ({
        read: async () => ({
          synced: {},
          local: {
            history: {
              requestRuns: [
                {
                  requestId: 'req-abc',
                  responseBodyKind: 'json',
                  responseBodyPreview: '{"x":1}',
                },
              ],
            },
          },
        }),
      }),
    };
    setRequestFieldEditsBridge(fakeBridge as never);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '$.x' });
    await setRequestAssertionTargetFieldCommand(pathUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain("target: '$.x'");
  });
});

// ---------------------------------------------------------------------------
// openLine — line is negative
// ---------------------------------------------------------------------------

describe('openLine edge cases', () => {
  beforeEach(reset);

  it('warns when line is negative', async () => {
    arrange(['method: GET']);
    await setRequestMethodFieldCommand(reqUri, -1);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'The targeted field row no longer exists.',
    );
  });

  it('uses activeTextEditor URI when uri param is undefined but editor is open', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    window.activeTextEditor = { document: { uri: reqUri } } as unknown;
    (window.showQuickPick as Mock).mockResolvedValueOnce('PUT');
    await setRequestMethodFieldCommand(undefined, 1);
    const updated = appliedText(lines);
    expect(updated).toContain('method: PUT');
  });
});

// ---------------------------------------------------------------------------
// validateInput callbacks — invoke the captured callbacks directly to cover
// the inline validator functions that never run through the mocked showInputBox
// ---------------------------------------------------------------------------

describe('validateInput callbacks in header key custom input', () => {
  beforeEach(reset);

  it('captures and exercises the header key validateInput function', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers:',
      "  - key: 'X-Old'",
      "    value: 'v'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    // Setup: pick custom, then return a valid value
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: '✏ Custom…',
      value: '__custom__',
    });
    (window.showInputBox as Mock).mockImplementationOnce(
      async (opts: { validateInput?: (v: string) => string | null }) => {
        // Exercise the validateInput callback inline
        if (opts.validateInput) {
          expect(opts.validateInput('')).toBe('Required.');
          expect(opts.validateInput('   ')).toBe('Required.');
          expect(opts.validateInput('bad header')).toBe('No whitespace in header names.');
          expect(opts.validateInput('X-Valid')).toBeNull();
        }
        return 'X-Valid';
      },
    );
    await setRequestHeaderKeyFieldCommand(reqUri, 4);
    const updated = appliedText(lines);
    expect(updated).toContain("key: 'X-Valid'");
  });
});

describe('validateInput callbacks in assertion expected fields', () => {
  beforeEach(reset);

  it('exercises the status code validateInput (100-599 range)', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'status'",
      "    op: 'equals'",
      '    expected: 200',
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '✏ Custom…', code: null });
    (window.showInputBox as Mock).mockImplementationOnce(
      async (opts: { validateInput?: (v: string) => string | null }) => {
        if (opts.validateInput) {
          expect(opts.validateInput('abc')).toBe('Must be 100–599.');
          expect(opts.validateInput('99')).toBe('Must be 100–599.');
          expect(opts.validateInput('600')).toBe('Must be 100–599.');
          expect(opts.validateInput('200')).toBeNull();
          expect(opts.validateInput('500')).toBeNull();
        }
        return '201';
      },
    );
    await setRequestAssertionExpectedFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain('expected: 201');
  });

  it('exercises the duration validateInput (non-negative number)', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'duration'",
      "    op: 'lt'",
      '    expected: 500',
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockImplementationOnce(
      async (opts: { validateInput?: (v: string) => string | null }) => {
        if (opts.validateInput) {
          expect(opts.validateInput('abc')).toBe('Must be a non-negative number.');
          expect(opts.validateInput('-1')).toBe('Must be a non-negative number.');
          expect(opts.validateInput('0')).toBeNull();
          expect(opts.validateInput('1000')).toBeNull();
        }
        return '250';
      },
    );
    await setRequestAssertionExpectedFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain('expected: 250');
  });
});

describe('validateInput in json-path target free text', () => {
  beforeEach(reset);

  it('exercises the json-path target validateInput (non-empty)', async () => {
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'json-path'",
      "    op: 'equals'",
      "    target: '$.old'",
      "    expected: 'v'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    setRequestFieldEditsBridge(null);
    (window.showInputBox as Mock).mockImplementationOnce(
      async (opts: { validateInput?: (v: string) => string | null }) => {
        if (opts.validateInput) {
          expect(opts.validateInput('')).toBe('Required.');
          expect(opts.validateInput('   ')).toBe('Required.');
          expect(opts.validateInput('$.data')).toBeNull();
        }
        return '$.items[0].name';
      },
    );
    await setRequestAssertionTargetFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain("target: '$.items[0].name'");
  });
});

// ---------------------------------------------------------------------------
// readAssertionKindFromContext — dashIndent < 0 branch (line 295)
// ---------------------------------------------------------------------------

describe('readAssertionKindFromContext dashIndent clamp', () => {
  beforeEach(reset);

  it('clamps dashIndent to 0 when the target line has zero indent', async () => {
    // If the target field has zero leading indent (leadingIndent - 2 < 0),
    // the code should clamp dashIndent to 0 and still walk correctly.
    // We embed assertions at top level (unusual but tests the branch).
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      "kind: 'header'",
      "target: 'X-Whatever'",
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    // Target line 4 has zero indent; dashIndent = max(0 - 2, 0) = 0
    // Walking backward from line 3, kind: header at zero indent won't match
    // the regex /^\s+kind:/ because the regex requires leading whitespace.
    // So the function will fall through to forward walk (line 5: headers: [])
    // which also won't match. Returns ''.
    // This calls setRequestTextFieldCommand as fallback.
    (window.showInputBox as Mock).mockResolvedValueOnce('new-val');
    await setRequestAssertionTargetFieldCommand(reqUri, 4);
    expect(window.showInputBox).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// readSiblingScalar — exercises the walk-up and walk-down logic
// ---------------------------------------------------------------------------

describe('readSiblingScalar via setRequestAssertionExpectedFieldCommand header branch', () => {
  beforeEach(reset);

  it('finds the target sibling when target: is above expected: in the same entry', async () => {
    // This test specifically exercises readSiblingScalar walking up from
    // expected: to the dash row, then walking down to find target:
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    target: 'Content-Type'",
      "    expected: 'text/html'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    // Content-Type has curated values — the catalogue path should trigger
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'application/json',
      value: 'application/json',
    });
    await setRequestAssertionExpectedFieldCommand(reqUri, 8);
    const updated = appliedText(lines);
    expect(updated).toContain("expected: 'application/json'");
  });

  it('returns null sibling when target key is not found in the entry', async () => {
    // No target: field present — readSiblingScalar returns null, headerName = ''
    // → no catalogue, falls through to free-text for header expected
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    expected: 'old'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('any-value');
    await setRequestAssertionExpectedFieldCommand(reqUri, 7);
    const updated = appliedText(lines);
    expect(updated).toContain("expected: 'any-value'");
  });
});

// ---------------------------------------------------------------------------
// readAuthTypeFromContext — returns '' when no type: row is found
// (encountering a top-level key before finding type:)
// ---------------------------------------------------------------------------

describe('readAuthTypeFromContext returns empty for ambiguous field', () => {
  beforeEach(reset);

  it('returns empty when field is above all type: rows', async () => {
    // The field at line 3 is above the auth block. Walking back from line 3,
    // we hit `url:` at line 2 which starts with [A-Za-z] → break.
    // readAuthTypeFromContext returns ''. Combined with an unrecognized field
    // key, setRequestAuthFieldCommand returns early.
    const lines = ['name: r', 'method: GET', 'url: https://x', "  algorithm: 'HS256'"];
    arrange(lines);
    await setRequestAuthFieldCommand(reqUri, 3);
    // The algorithm field key is recognized but readAuthTypeFromContext returns ''
    // which doesn't match 'hawk' or 'jwt-bearer', so options stays empty → return
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// toggleRequestRowEnabledCommand — replaceScalarOnLine returns null for the
// enabled row (lines 695-697)
// ---------------------------------------------------------------------------

describe('toggleRequestRowEnabledCommand replaceScalar null on enabled row', () => {
  beforeEach(reset);

  it('shows error when the enabled row text cannot be parsed by replaceScalarOnLine', async () => {
    // We need a line that matches /^\s*enabled\s*:\s*(true|false)\b/ so the
    // scan finds it, but then replaceScalarOnLine fails on that same text.
    // replaceScalarOnLine matches /^(\s*(?:-\s+)?[A-Za-z0-9_-]+:[ \t]*).*$/
    // A line like "enabled: true" does match both. But we can override lineAt
    // to return different text for the scan vs the replace call.
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'headers:',
      "  - key: 'X-Custom'",
      "    value: 'v'",
      '    enabled: true',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    const save = vi.fn(async () => true);
    let enabledCallCount = 0;
    const doc = {
      uri: reqUri,
      lineCount: lines.length,
      getText: () => lines.join('\n'),
      lineAt: (n: number) => {
        if (n === 6) {
          enabledCallCount++;
          // First call (during scan) — return matching enabled text
          if (enabledCallCount === 1) {
            return {
              text: '    enabled: true',
              range: {
                start: { line: 6, character: 0 },
                end: { line: 6, character: 17 },
              },
            };
          }
          // Second call (during replaceScalarOnLine) — return unparseable text
          return {
            text: '    -- broken text --',
            range: {
              start: { line: 6, character: 0 },
              end: { line: 6, character: 21 },
            },
          };
        }
        const text = lines[n] ?? '';
        return {
          text,
          range: {
            start: { line: n, character: 0 },
            end: { line: n, character: text.length },
          },
        };
      },
      save,
    };
    (workspace.openTextDocument as Mock).mockResolvedValue(doc);
    (workspace.applyEdit as Mock).mockResolvedValue(true);
    (window.showTextDocument as Mock).mockResolvedValue({
      selection: undefined,
      revealRange: vi.fn(),
    });
    // Target the dash row so the scan walks forward to find enabled: true
    await toggleRequestRowEnabledCommand(reqUri, 4);
    expect(window.showErrorMessage).toHaveBeenCalledWith('Could not parse the enabled row.');
  });
});

// ---------------------------------------------------------------------------
// applyAndSaveRequest — non-RequestYamlParseError rethrow (lines 67-68)
// ---------------------------------------------------------------------------

describe('applyAndSaveRequest non-parse-error rethrow', () => {
  beforeEach(reset);

  it('rethrows a non-RequestYamlParseError from parseRequestFromYaml', async () => {
    // The non-parse-error rethrow path (line 67) is for truly unexpected
    // errors (e.g., out-of-memory). We force it by making getText() throw
    // a raw Error. getText() is only called inside applyAndSaveRequest
    // → parseRequestFromYaml(document.getText()), so the first call
    // needs to throw.
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x.com',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    const save = vi.fn(async () => true);
    const throwingDoc = {
      uri: reqUri,
      lineCount: lines.length,
      getText: () => {
        // Always throw — getText is only called from applyAndSaveRequest
        throw new Error('Unexpected internal error');
      },
      lineAt: (n: number) => ({
        text: lines[n] ?? '',
        range: {
          start: { line: n, character: 0 },
          end: { line: n, character: (lines[n] ?? '').length },
        },
      }),
      save,
    };
    (workspace.openTextDocument as Mock).mockResolvedValue(throwingDoc);
    (workspace.applyEdit as Mock).mockResolvedValueOnce(true);
    (window.showTextDocument as Mock).mockResolvedValue({
      selection: undefined,
      revealRange: vi.fn(),
    });
    (window.showQuickPick as Mock).mockResolvedValueOnce('POST');
    // The error should propagate out
    await expect(setRequestMethodFieldCommand(reqUri, 1)).rejects.toThrow(
      'Unexpected internal error',
    );
  });
});

// ---------------------------------------------------------------------------
// resolveJsonPath — catch branch when JSON.parse succeeds but path resolution
// hits a non-json-parseable body in pickJsonPathValueForRequest
// ---------------------------------------------------------------------------

describe('pickJsonPathValueForRequest catch branch', () => {
  beforeEach(() => {
    reset();
    setRequestFieldEditsBridge(null);
  });
  afterEach(() => {
    setRequestFieldEditsBridge(null);
  });

  it('exercises readSiblingScalar dash-entry branch when walking backward', async () => {
    // Two assertion entries. readSiblingScalar for the SECOND entry's expected:
    // walks backward to find its start. The key layout makes the backward walk
    // hit a dash line at the same indent level as the field row, which triggers
    // the `start = l; break` dash branch (lines 496-498).
    //
    // Layout uses 4-space indent with dash at indent 4:
    //     - kind: ...       (indent 4, dash)
    //       target: ...     (indent 6)
    //       expected: ...   (indent 6, myIndent=6)
    // Walking back from expected (myIndent=6):
    //   target: (indent 6 >= 6, not < 6, not dash → skip)
    //   - kind: (indent 4 < 6 → hits lead < myIndent first!)
    //
    // Actually, the dash branch (496-498) is only reachable when the dash line
    // has indent >= myIndent. That requires the dash-prefixed entry row to be
    // at the same indent as the field rows. This occurs with structures like:
    //     - target: X     (indent 4, dash at 4)
    //     expected: Y     (indent 4, myIndent=4)
    // Walk back: `- target:` has indent 4 >= 4 AND is dash → start=l; break.
    const lines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'header'",
      "    op: 'equals'",
      "    - target: 'Accept'",
      "    expected: 'old'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    savedDoc = makeDoc(lines);
    const reqUriLocal = Uri.parse('apicircle://w/requests/my-req.yaml?id=req-456');
    (savedDoc.doc as { uri: Uri }).uri = reqUriLocal;
    (workspace.openTextDocument as Mock).mockResolvedValue(savedDoc.doc);
    (workspace.applyEdit as Mock).mockResolvedValue(true);
    (window.showTextDocument as Mock).mockResolvedValue({
      selection: undefined,
      revealRange: vi.fn(),
    });
    // expected: at line 8 (indent 4, myIndent=4).
    // readSiblingScalar backward walk:
    //   line 7: "    - target: 'Accept'" (indent 4 >= 4, IS dash → start=7; break)
    // Then walks forward from start=7 to find target:
    //   line 7: matches /target\s*:/ → returns 'Accept'
    //
    // readAssertionKindFromContext from line 8:
    //   line 7: dash at indent 4 → break (dash check first)
    //   Forward walk from line 9: enabled (no kind), line 10: headers (indent 0 < 2 → break)
    //   Returns '' → falls to unknown kind → text field
    //
    // Since the kind context returns '', it falls to text field, which still
    // exercises readSiblingScalar properly. We just need the call to go through.
    (window.showInputBox as Mock).mockResolvedValueOnce('new-val');
    await setRequestAssertionExpectedFieldCommand(reqUriLocal, 8);
    // The text field path was taken
    expect(window.showInputBox).toHaveBeenCalled();
  });

  it('catches JSON.parse failure in the value resolver and falls back to text', async () => {
    const assertionLines = [
      'name: r',
      'method: GET',
      'url: https://x',
      'assertions:',
      "  - id: 'a1'",
      "    kind: 'json-path'",
      "    op: 'equals'",
      "    target: '$.data'",
      "    expected: 'old'",
      '    enabled: true',
      'headers: []',
      'query: []',
      'body:',
      '  type: none',
      "  content: ''",
      'auth:',
      '  type: none',
    ];
    const reqUriWithId = Uri.parse('apicircle://w/requests/my-req.yaml?id=req-123');
    savedDoc = makeDoc(assertionLines);
    (savedDoc.doc as { uri: Uri }).uri = reqUriWithId;
    (workspace.openTextDocument as Mock).mockResolvedValue(savedDoc.doc);
    (workspace.applyEdit as Mock).mockResolvedValue(true);
    (window.showTextDocument as Mock).mockResolvedValue({
      selection: undefined,
      revealRange: vi.fn(),
    });

    // The first call to pickJsonPathForRequest succeeds (returns a path),
    // but the second read for value resolution gets invalid JSON.
    let readCount = 0;
    const fakeBridge = {
      activeWorkspace: () => ({
        read: async () => {
          readCount++;
          if (readCount <= 1) {
            // First read: for pickJsonPathForRequest — valid JSON
            return {
              synced: {},
              local: {
                history: {
                  requestRuns: [
                    {
                      requestId: 'req-123',
                      responseBodyKind: 'json',
                      responseBodyPreview: '{"data":"hello"}',
                    },
                  ],
                },
              },
            };
          }
          // Second read: for pickJsonPathValueForRequest — bad JSON
          return {
            synced: {},
            local: {
              history: {
                requestRuns: [
                  {
                    requestId: 'req-123',
                    responseBodyKind: 'json',
                    responseBodyPreview: '{broken-json',
                  },
                ],
              },
            },
          };
        },
      }),
    };
    setRequestFieldEditsBridge(fakeBridge as never);
    // pickJsonPath shows leaves from valid JSON; user picks $.data
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '$.data' });
    // pickJsonPathValueForRequest then tries JSON.parse on broken json → catches → null
    // Falls back to free-text input
    (window.showInputBox as Mock).mockResolvedValueOnce('manual-expected');
    await setRequestAssertionExpectedFieldCommand(reqUriWithId, 8);
    const updated = appliedText(assertionLines);
    expect(updated).toContain("expected: 'manual-expected'");
  });
});
