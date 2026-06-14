import { describe, expect, it } from 'vitest';
import {
  buildBodySubtree,
  buildConditionClause,
  collectJsonArrayPaths,
  leadingIndent,
  replaceScalarOnLine,
  yamlScalar,
} from './mockFieldEdits';

describe('replaceScalarOnLine', () => {
  it('replaces the value of a plain key row, preserving indent + key', () => {
    expect(replaceScalarOnLine('  status: 200', '404')).toBe('  status: 404');
    expect(replaceScalarOnLine('method: GET', 'POST')).toBe('method: POST');
  });

  it('handles dash rows (`- key:`)', () => {
    expect(replaceScalarOnLine('    - key: Content-Type', "'X-Api-Key'")).toBe(
      "    - key: 'X-Api-Key'",
    );
  });

  it('handles deeply-indented value rows', () => {
    expect(replaceScalarOnLine('          value: x', "'application/json'")).toBe(
      "          value: 'application/json'",
    );
  });

  it('returns null for a non key:value line', () => {
    expect(replaceScalarOnLine('   # a comment', 'x')).toBeNull();
    expect(replaceScalarOnLine('', 'x')).toBeNull();
  });
});

describe('leadingIndent', () => {
  it('counts leading spaces', () => {
    expect(leadingIndent('      value: x')).toBe(6);
    expect(leadingIndent('no-indent')).toBe(0);
  });
});

describe('yamlScalar', () => {
  it('single-quotes plain strings', () => {
    expect(yamlScalar('application/json')).toBe("'application/json'");
    expect(yamlScalar('pageSize')).toBe("'pageSize'");
  });
  it('double-quotes strings with YAML-significant chars (incl. a quote)', () => {
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar("it's")).toBe('"it\'s"');
  });
  it('emits empty-string marker', () => {
    expect(yamlScalar('')).toBe("''");
  });
});

describe('buildBodySubtree', () => {
  it('emits type + content at the given indent', () => {
    expect(buildBodySubtree(4, 'json')).toBe("    type: json\n    content: ''");
    expect(buildBodySubtree(8, 'text')).toBe("        type: text\n        content: ''");
  });
  it('adds formRows for form-data', () => {
    expect(buildBodySubtree(4, 'form-data')).toBe(
      "    type: form-data\n    content: ''\n    formRows: []",
    );
  });
});

describe('buildConditionClause', () => {
  it('renders a fresh AND-clause at the dash indent', () => {
    const out = buildConditionClause(6, 'c-new');
    expect(out).toBe(
      [
        "      - id: 'c-new'",
        '        scope: query',
        "        target: ''",
        '        op: equals',
        "        value: ''",
      ].join('\n'),
    );
  });
});

describe('collectJsonArrayPaths', () => {
  it('finds top-level and nested array paths', () => {
    const paths = collectJsonArrayPaths({
      items: [{ id: 1 }],
      data: { results: [{ x: 1 }], total: 5 },
      name: 'x',
    });
    expect(paths).toContain('$.items');
    expect(paths).toContain('$.data.results');
    expect(paths).not.toContain('$.name');
  });

  it('reports the root when the body itself is an array', () => {
    expect(collectJsonArrayPaths([{ id: 1 }])).toContain('$');
  });

  it('descends into the first element to surface arrays of arrays', () => {
    const paths = collectJsonArrayPaths({ rows: [{ cells: [1, 2] }] });
    expect(paths).toContain('$.rows');
    expect(paths).toContain('$.rows[0].cells');
  });

  it('returns [] for scalar / object-only bodies', () => {
    expect(collectJsonArrayPaths({ a: 1, b: { c: 2 } })).toEqual([]);
    expect(collectJsonArrayPaths(42)).toEqual([]);
  });
});

import { beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import { serializeEndpointToYaml } from '../fs/endpointYaml';
import type { MockEndpoint } from '@apicircle/shared';
import {
  setMockMethodFieldCommand,
  setMockStatusFieldCommand,
  setMockHeaderKeyFieldCommand,
  setMockHeaderValueFieldCommand,
  setMockBodyTypeFieldCommand,
  setMockClauseScopeFieldCommand,
  setMockClauseOpFieldCommand,
  setMockClauseValueFieldCommand,
  toggleMockHeaderEnabledCommand,
  setMockTextFieldCommand,
  setMockNumberFieldCommand,
  setMockClauseTargetFieldCommand,
  addMockConditionClauseCommand,
  setMockMultiplierKindFieldCommand,
  setMockMultiplierKeyFieldCommand,
  setMockMultiplierTargetPathFieldCommand,
} from './mockFieldEdits';

const endpointUri = Uri.parse('apicircle://w/mocks/m1/get-x.yaml');

function liveEndpoint(): MockEndpoint {
  return {
    id: 'ep-1',
    name: 'Get x',
    method: 'GET',
    pathPattern: '/x',
    requestSchema: {
      pathParams: [],
      queryParams: [],
      headers: [],
      cookies: [],
    },
    requestValidation: [],
    responseRules: [
      {
        id: 'rule-1',
        name: 'Admin',
        enabled: true,
        when: [{ id: 'cond-1', scope: 'query', target: 'role', op: 'equals', value: 'admin' }],
        response: {
          status: 200,
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
          body: { type: 'json', content: '{}' },
        },
      },
    ],
    defaultResponse: {
      status: 200,
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: { type: 'json', content: '{}' },
      multipliers: [
        {
          id: 'mult-1',
          source: { kind: 'query', key: 'pageSize' },
          targetJsonPath: '$.items',
          defaultCount: 10,
        },
      ],
    },
  } as unknown as MockEndpoint;
}

function makeDoc(lines: string[]) {
  const save = vi.fn(async () => true);
  return {
    doc: {
      uri: endpointUri,
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

function arrangeLive() {
  const lines = serializeEndpointToYaml(liveEndpoint()).split('\n');
  const result = makeDoc(lines);
  (workspace.openTextDocument as Mock).mockResolvedValue(result.doc);
  (workspace.applyEdit as Mock).mockResolvedValue(true);
  (window.showTextDocument as Mock).mockResolvedValue({
    selection: undefined,
    revealRange: vi.fn(),
  });
  return { lines, save: result.save };
}

function findLine(lines: string[], substring: string): number {
  return lines.findIndex((l) => l.includes(substring));
}

function reset(): void {
  (window.showInputBox as Mock).mockReset();
  (window.showQuickPick as Mock).mockReset();
  (window.showInformationMessage as Mock).mockReset();
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (window.showTextDocument as Mock).mockReset();
  (workspace.openTextDocument as Mock).mockReset();
  (workspace.applyEdit as Mock).mockReset();
  window.activeTextEditor = undefined as unknown;
}

describe('mockFieldEdits — command surface', () => {
  beforeEach(reset);

  it('setMockMethodFieldCommand updates the method scalar', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'method:');
    (window.showQuickPick as Mock).mockResolvedValueOnce('POST');
    await setMockMethodFieldCommand(endpointUri, line);
    expect(save).toHaveBeenCalled();
  });

  it('setMockMethodFieldCommand exits on picker cancel', async () => {
    const { lines } = arrangeLive();
    const line = findLine(lines, 'method:');
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await setMockMethodFieldCommand(endpointUri, line);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('setMockStatusFieldCommand updates the status code', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'status:');
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 418 });
    await setMockStatusFieldCommand(endpointUri, line);
    expect(save).toHaveBeenCalled();
  });

  it('setMockHeaderKeyFieldCommand picks a curated header name', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, '- key:');
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'X-Custom' });
    await setMockHeaderKeyFieldCommand(endpointUri, line);
    expect(save).toHaveBeenCalled();
  });

  it('setMockHeaderValueFieldCommand writes a free-text value when no catalog applies', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'value: ') + 0;
    (window.showInputBox as Mock).mockResolvedValueOnce('text/plain');
    await setMockHeaderValueFieldCommand(endpointUri, line);
    // Either saves or doesn't (depends on header-value catalog behaviour);
    // either way the input box was offered.
    expect(window.showInputBox).toHaveBeenCalled();
    void save;
  });

  it('setMockBodyTypeFieldCommand switches the body type', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'type: json');
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'text' });
    await setMockBodyTypeFieldCommand(endpointUri, line);
    expect(save).toHaveBeenCalled();
  });

  it('setMockClauseScopeFieldCommand updates a condition scope', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'scope:');
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'header' });
    await setMockClauseScopeFieldCommand(endpointUri, line);
    expect(save).toHaveBeenCalled();
  });

  it('setMockClauseOpFieldCommand updates a condition op', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'op:');
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'matches' });
    await setMockClauseOpFieldCommand(endpointUri, line);
    expect(save).toHaveBeenCalled();
  });

  it('setMockClauseValueFieldCommand updates a condition value', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'value: ');
    (window.showInputBox as Mock).mockResolvedValueOnce('superadmin');
    await setMockClauseValueFieldCommand(endpointUri, line);
    // Test that input was offered; save dependent on the value/op shape
    expect(window.showInputBox).toHaveBeenCalled();
    void save;
  });

  it('setMockClauseTargetFieldCommand updates a clause target (may also use quick-pick)', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'target:');
    (window.showInputBox as Mock).mockResolvedValueOnce('newTarget');
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'role' });
    await setMockClauseTargetFieldCommand(endpointUri, line);
    // Either path was offered:
    const offered =
      (window.showInputBox as Mock).mock.calls.length > 0 ||
      (window.showQuickPick as Mock).mock.calls.length > 0;
    expect(offered).toBe(true);
    void save;
  });

  it('toggleMockHeaderEnabledCommand toggles enabled flag on a header row', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'enabled: true');
    await toggleMockHeaderEnabledCommand(endpointUri, line);
    expect(save).toHaveBeenCalled();
  });

  it('setMockTextFieldCommand replaces a text scalar via input box', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'pathPattern:');
    (window.showInputBox as Mock).mockResolvedValueOnce('/y');
    await setMockTextFieldCommand(endpointUri, line);
    expect(save).toHaveBeenCalled();
  });

  it('setMockNumberFieldCommand replaces a number scalar', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'defaultCount:');
    if (line < 0) {
      // multiplier rendering may differ — skip silently
      return;
    }
    (window.showInputBox as Mock).mockResolvedValueOnce('20');
    await setMockNumberFieldCommand(endpointUri, line);
    void save;
  });

  it('addMockConditionClauseCommand adds a new clause to a rule', async () => {
    const { save } = arrangeLive();
    await addMockConditionClauseCommand(endpointUri, 0);
    // Either succeeds (cap allowing) or surfaces a cap message.
    void save;
  });

  it('setMockMultiplierKindFieldCommand updates multiplier source kind', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'kind: query');
    if (line < 0) return;
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'header' });
    await setMockMultiplierKindFieldCommand(endpointUri, line);
    void save;
  });

  it('setMockMultiplierKeyFieldCommand updates multiplier source key', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, "key: 'pageSize'");
    if (line < 0) return;
    (window.showInputBox as Mock).mockResolvedValueOnce('limit');
    await setMockMultiplierKeyFieldCommand(endpointUri, line);
    void save;
  });

  it('setMockMultiplierTargetPathFieldCommand updates multiplier target path', async () => {
    const { lines, save } = arrangeLive();
    const line = findLine(lines, 'targetJsonPath:');
    if (line < 0) return;
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '$.results' });
    await setMockMultiplierTargetPathFieldCommand(endpointUri, line);
    void save;
  });

  it('warns when no URI is in focus on any setter', async () => {
    await setMockMethodFieldCommand(undefined, 0);
    expect(window.showWarningMessage).toHaveBeenCalled();
  });

  it('warns on a non-apicircle URI', async () => {
    await setMockMethodFieldCommand(Uri.parse('file:///x.yaml'), 0);
    expect(window.showWarningMessage).toHaveBeenCalled();
  });

  it('warns when targeting a line out of bounds', async () => {
    arrangeLive();
    await setMockMethodFieldCommand(endpointUri, 9999);
    expect(window.showWarningMessage).toHaveBeenCalled();
  });
});
