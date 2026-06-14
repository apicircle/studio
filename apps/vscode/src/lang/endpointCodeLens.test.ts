import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { EndpointCodeLensProvider } from './endpointCodeLens';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
} as unknown as vscode.CancellationToken;

const ENDPOINT_URI = Uri.parse('apicircle://x/mocks/m-1/ep-1.yaml');

describe('EndpointCodeLensProvider', () => {
  const provider = new EndpointCodeLensProvider();

  it('returns [] for non-endpoint files', () => {
    expect(
      provider.provideCodeLenses(
        makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), ['name: x']),
        fakeToken,
      ),
    ).toEqual([]);
  });

  it('emits ✱ Add multiplier above defaultResponse: + field lenses on its rows', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: List pets',
        'method: GET',
        'pathPattern: /pets',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: json',
        '    content: "{}"',
      ]),
      fakeToken,
    );
    const cmds = lenses.map((l) => l.command?.command).filter(Boolean);
    // Add-multiplier appears (no multiplier present yet).
    expect(cmds).toContain('apicircle.addMockMultiplier');
    // Field editors are now on the field rows, line-addressed.
    const method = lenses.find((l) => l.command?.command === 'apicircle.setMockMethodField');
    const status = lenses.find((l) => l.command?.command === 'apicircle.setMockStatusField');
    const bodyType = lenses.find((l) => l.command?.command === 'apicircle.setMockBodyTypeField');
    expect(method?.command?.arguments).toEqual([ENDPOINT_URI, 1]); // method: line
    expect(status?.command?.arguments).toEqual([ENDPOINT_URI, 4]); // status: line
    expect(bodyType?.command?.arguments).toEqual([ENDPOINT_URI, 7]); // type: line
    // The old section-header status / body-type lenses are gone.
    expect(cmds).not.toContain('apicircle.switchMockResponseBodyType');
    expect(cmds).not.toContain('apicircle.setMockResponseStatus');
  });

  it('emits header ◆ Key / ◆ Value field lenses inside a headers list', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'defaultResponse:',
        '  status: 200',
        '  headers:',
        '    - key: Content-Type',
        '      value: application/json',
        '      enabled: true',
        '  body:',
        '    type: json',
        '    content: "{}"',
      ]),
      fakeToken,
    );
    const key = lenses.find((l) => l.command?.command === 'apicircle.setMockHeaderKeyField');
    const value = lenses.find((l) => l.command?.command === 'apicircle.setMockHeaderValueField');
    expect(key?.command?.arguments).toEqual([ENDPOINT_URI, 6]);
    expect(value?.command?.arguments).toEqual([ENDPOINT_URI, 7]);
  });

  it('emits ✚ Add response rule above responseRules:', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'responseRules: []',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: none',
        '    content: ""',
      ]),
      fakeToken,
    );
    const add = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.addMockResponseRule' &&
        (l.command?.arguments?.length ?? 0) === 1,
    );
    expect(add).toBeDefined();
  });

  it('emits 🛡 Add validation rule above requestValidation:', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'requestValidation: []',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: none',
        '    content: ""',
      ]),
      fakeToken,
    );
    const add = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.addMockValidationRule' &&
        (l.command?.arguments?.length ?? 0) === 1,
    );
    expect(add).toBeDefined();
  });

  it('emits per-rule lenses with the rule id baked in', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'responseRules:',
        '  - id: r1',
        '    name: Page 1',
        '    enabled: true',
        '    when:',
        '      - id: c1',
        '        scope: query',
        '        target: page',
        '        op: equals',
        '        value: "1"',
        '    response:',
        '      status: 200',
        '      headers: []',
        '      body:',
        '        type: json',
        '        content: "{}"',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: none',
        '    content: ""',
      ]),
      fakeToken,
    );
    // The rule row keeps Enable/Disable + Remove (status / body type moved to
    // the field rows; ✚ Add header moved to the response.headers block).
    const remove = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.removeMockResponseRule' &&
        (l.command?.arguments?.[1] as string) === 'r1',
    );
    const addHeader = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.addMockResponseHeader' &&
        (l.command?.arguments?.[1] as string) === 'r1',
    );
    expect(remove).toBeDefined();
    // ✚ Add header now anchors on the rule's response `headers:` line (index 15).
    expect(addHeader).toBeDefined();
    expect(addHeader?.command?.arguments?.[0]).toBe(ENDPOINT_URI);
    expect((addHeader?.range as vscode.Range).start.line).toBe(15);
    // Field editors: the clause scope/op/target/value + the response status.
    const cmds = lenses.map((l) => l.command?.command);
    expect(cmds).toContain('apicircle.setMockClauseScopeField');
    expect(cmds).toContain('apicircle.setMockClauseOpField');
    expect(cmds).toContain('apicircle.setMockClauseTargetField');
    expect(cmds).toContain('apicircle.setMockClauseValueField');
    expect(cmds).toContain('apicircle.setMockStatusField');
    // The rule already has 1 clause → ✚ Add condition is hidden (cap = 1).
    expect(cmds).not.toContain('apicircle.addMockConditionClause');
  });

  it('emits multiplier field lenses (kind / key / path) + per-entry remove; Add hidden at cap', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: json',
        '    content: "{}"',
        '  multipliers:',
        '    - id: m1',
        '      source:',
        '        kind: query',
        '        key: pageSize',
        '      targetJsonPath: $.items',
        '      defaultCount: 10',
      ]),
      fakeToken,
    );
    // At the cap (1 entry, MAX=1) → no Add; Remove carries the entry id.
    expect(lenses.map((l) => l.command?.command)).not.toContain('apicircle.addMockMultiplier');
    const remove = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.removeMockMultiplier' &&
        (l.command?.arguments?.[1] as string) === 'm1',
    );
    expect(remove).toBeDefined();
    const kind = lenses.find((l) => l.command?.command === 'apicircle.setMockMultiplierKindField');
    const path = lenses.find(
      (l) => l.command?.command === 'apicircle.setMockMultiplierTargetPathField',
    );
    expect(kind?.command?.arguments).toEqual([ENDPOINT_URI, 12]);
    expect(path?.command?.arguments).toEqual([ENDPOINT_URI, 14]);
    // source.key, defaultCount, name, min, max fields have no CodeLens —
    // they are edited directly in YAML.
    expect(
      lenses.find((l) => l.command?.command === 'apicircle.setMockMultiplierKeyField'),
    ).toBeUndefined();
  });

  it('emits ✕ Remove validation lenses with the rule id baked in', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'requestValidation:',
        '  - id: v1',
        '    kind: header-required',
        '    target: Authorization',
        '    enabled: true',
        '    failResponse:',
        '      status: 401',
        '      headers: []',
        '      body:',
        '        type: json',
        '        content: "{}"',
      ]),
      fakeToken,
    );
    const remove = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.removeMockValidationRule' &&
        (l.command?.arguments?.[1] as string) === 'v1',
    );
    expect(remove).toBeDefined();
  });

  it('emits ◆ Kind / ◆ Target / ◆ Value field lenses for a value-comparing kind', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'requestValidation:',
        '  - id: v1',
        '    kind: header-equals',
        '    target: Authorization',
        '    expected: Bearer x',
        '    enabled: true',
        '    failResponse:',
        '      status: 401',
        '      headers: []',
        '      body:',
        '        type: json',
        '        content: "{}"',
      ]),
      fakeToken,
    );
    const find = (cmd: string) =>
      lenses.find(
        (l) => l.command?.command === cmd && (l.command?.arguments?.[1] as string) === 'v1',
      );
    expect(find('apicircle.setMockValidationKind')).toBeDefined();
    expect(find('apicircle.setMockValidationTarget')).toBeDefined();
    expect(find('apicircle.setMockValidationExpected')).toBeDefined();
  });

  it('omits ◆ Target and ◆ Value for body-required (no target / no value)', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'requestValidation:',
        '  - id: v2',
        '    kind: body-required',
        '    target: ""',
        '    enabled: true',
        '    failResponse:',
        '      status: 400',
        '      headers: []',
        '      body:',
        '        type: json',
        '        content: "{}"',
      ]),
      fakeToken,
    );
    const cmds = lenses.map((l) => l.command?.command);
    expect(cmds).toContain('apicircle.setMockValidationKind');
    expect(cmds).not.toContain('apicircle.setMockValidationTarget');
    expect(cmds).not.toContain('apicircle.setMockValidationExpected');
  });

  it('shows ◆ Target but not ◆ Value for a required (no-value) kind', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'requestValidation:',
        '  - id: v3',
        '    kind: header-required',
        '    target: X-Api-Key',
        '    enabled: true',
        '    failResponse:',
        '      status: 400',
        '      headers: []',
        '      body:',
        '        type: json',
        '        content: "{}"',
      ]),
      fakeToken,
    );
    const cmds = lenses.map((l) => l.command?.command);
    expect(cmds).toContain('apicircle.setMockValidationTarget');
    expect(cmds).not.toContain('apicircle.setMockValidationExpected');
  });

  // ----- #8 requestSchema authoring lenses -----

  it('emits ✚ Add request schema on requestValidation when no requestSchema block exists', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /pets/{petId}',
        'requestValidation: []',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: none',
        '    content: ""',
      ]),
      fakeToken,
    );
    const add = lenses.find((l) => l.command?.command === 'apicircle.addMockRequestSchema');
    expect(add).toBeDefined();
    expect((add?.range as vscode.Range).start.line).toBe(3); // requestValidation: line
    // The per-list add lenses only appear once the block exists.
    expect(lenses.map((l) => l.command?.command)).not.toContain(
      'apicircle.addMockRequestSchemaParam',
    );
  });

  it('emits the 5 add lenses + ◆ param field lenses when requestSchema exists', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /pets/{petId}',
        'requestSchema:',
        '  pathParams:',
        '    - id: p1',
        '      name: petId',
        '      typeHint: string',
        '      required: true',
        "      example: '1'",
        '  queryParams: []',
        '  headers:',
        '    - id: h1',
        '      name: Authorization',
        '      typeHint: string',
        '      required: false',
        "      example: ''",
        '  cookies: []',
        'requestValidation: []',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: none',
        '    content: ""',
      ]),
      fakeToken,
    );
    const cmds = lenses.map((l) => l.command?.command);
    // Section add lenses on the requestSchema: line (index 3).
    const paramAdds = lenses.filter(
      (l) => l.command?.command === 'apicircle.addMockRequestSchemaParam',
    );
    expect(paramAdds.map((l) => l.command?.arguments?.[1]).sort()).toEqual([
      'cookies',
      'headers',
      'pathParams',
      'queryParams',
    ]);
    // Each param add-lens anchors on top of its own subsection line, not the
    // requestSchema: header.
    const addByKind = (kind: string) => paramAdds.find((l) => l.command?.arguments?.[1] === kind);
    expect((addByKind('pathParams')?.range as vscode.Range).start.line).toBe(4);
    expect((addByKind('queryParams')?.range as vscode.Range).start.line).toBe(10);
    expect((addByKind('headers')?.range as vscode.Range).start.line).toBe(11);
    expect((addByKind('cookies')?.range as vscode.Range).start.line).toBe(17);
    expect(cmds).toContain('apicircle.addMockRequestSchemaBodyExample');
    // No body block in this schema → ✚ Body example falls back to the
    // requestSchema: header line (index 3).
    const bodyEx = lenses.find(
      (l) => l.command?.command === 'apicircle.addMockRequestSchemaBodyExample',
    );
    expect((bodyEx?.range as vscode.Range).start.line).toBe(3);
    // ◆ field lenses: Type only. Name / Example / Description are edited
    // directly in YAML (no lens). The boolean `required:` row also has no lens.
    expect(cmds).toContain('apicircle.setMockParamTypeField');
    expect(cmds).not.toContain('apicircle.toggleMockParamRequired');
    expect(cmds).not.toContain('apicircle.setMockHeaderParamNameField');
  });

  it('does NOT emit ◆ Name / ◆ Example / ◆ Description on requestSchema param rows', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /pets/{petId}',
        'requestSchema:',
        '  pathParams:',
        '    - id: p1',
        '      name: petId',
        '      description: The pet id',
        '      example: abc',
        '  queryParams: []',
        '  headers: []',
        '  cookies: []',
        'requestValidation: []',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: none',
        '    content: ""',
      ]),
      fakeToken,
    );
    const titles = lenses.map((l) => l.command?.title as string);
    expect(titles).not.toContain('◆ Name');
    expect(titles).not.toContain('◆ Example');
    expect(titles).not.toContain('◆ Description');
  });

  // ----- #6 ⟳ Format JSON on a json body content row -----

  it('emits ⟳ Format JSON on a json body content row, not on a non-json body', () => {
    const jsonLenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: json',
        '    content: "{}"',
      ]),
      fakeToken,
    );
    const fmt = jsonLenses.find((l) => l.command?.command === 'apicircle.formatJson');
    expect(fmt?.command?.arguments).toEqual([ENDPOINT_URI, 8]); // content: line

    const noneLenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'defaultResponse:',
        '  status: 204',
        '  headers: []',
        '  body:',
        '    type: none',
        '    content: ""',
      ]),
      fakeToken,
    );
    expect(noneLenses.map((l) => l.command?.command)).not.toContain('apicircle.formatJson');
  });

  // ----- #5 per-header enable/disable toggle -----

  it('emits a ⊘ Disable / ✓ Enable toggle on each response header key row', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'defaultResponse:',
        '  status: 200',
        '  headers:',
        '    - key: Content-Type',
        '      value: application/json',
        '      enabled: true',
        '    - key: X-Trace',
        '      value: on',
        '      enabled: false',
        '  body:',
        '    type: none',
        '    content: ""',
      ]),
      fakeToken,
    );
    const toggles = lenses.filter(
      (l) => l.command?.command === 'apicircle.toggleMockHeaderEnabled',
    );
    // One toggle per header key row (lines 6 and 9).
    expect(toggles.map((t) => t.command?.arguments?.[1]).sort()).toEqual([6, 9]);
    const enabledHeader = toggles.find((t) => t.command?.arguments?.[1] === 6);
    const disabledHeader = toggles.find((t) => t.command?.arguments?.[1] === 9);
    expect(enabledHeader?.command?.title).toBe('⊘ Disable');
    expect(disabledHeader?.command?.title).toBe('✓ Enable');
  });

  // ----- #2 clause value: curated vs hidden -----

  it('emits ◆ Value (setMockClauseValueField) for a value-comparing clause op', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'responseRules:',
        '  - id: r1',
        '    name: r',
        '    enabled: true',
        '    when:',
        '      - id: c1',
        '        scope: header',
        '        target: Content-Type',
        '        op: equals',
        "        value: ''",
        '    response:',
        '      status: 200',
        '      headers: []',
        '      body:',
        '        type: none',
        '        content: ""',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: none',
        '    content: ""',
      ]),
      fakeToken,
    );
    const value = lenses.find((l) => l.command?.command === 'apicircle.setMockClauseValueField');
    expect(value?.command?.arguments).toEqual([ENDPOINT_URI, 12]); // value: line
  });

  it('omits ◆ Value entirely when the clause op is present / absent', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'responseRules:',
        '  - id: r1',
        '    name: r',
        '    enabled: true',
        '    when:',
        '      - id: c1',
        '        scope: header',
        '        target: X-Api-Key',
        '        op: present',
        '    response:',
        '      status: 200',
        '      headers: []',
        '      body:',
        '        type: none',
        '        content: ""',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: none',
        '    content: ""',
      ]),
      fakeToken,
    );
    const cmds = lenses.map((l) => l.command?.command);
    expect(cmds).not.toContain('apicircle.setMockClauseValueField');
    expect(cmds).toContain('apicircle.setMockClauseOpField');
  });

  // ----- #4 when-condition cap -----

  it('shows ✚ Add condition when the rule has no clause (when: [])', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(ENDPOINT_URI, [
        'name: X',
        'method: GET',
        'pathPattern: /x',
        'responseRules:',
        '  - id: r1',
        '    name: r',
        '    enabled: true',
        '    when: []',
        '    response:',
        '      status: 200',
        '      headers: []',
        '      body:',
        '        type: none',
        '        content: ""',
        'defaultResponse:',
        '  status: 200',
        '  headers: []',
        '  body:',
        '    type: none',
        '    content: ""',
      ]),
      fakeToken,
    );
    expect(lenses.map((l) => l.command?.command)).toContain('apicircle.addMockConditionClause');
  });
});
