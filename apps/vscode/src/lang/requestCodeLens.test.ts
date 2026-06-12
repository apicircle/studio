import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { RequestCodeLensProvider } from './requestCodeLens';
import { InFlightSendTracker } from '../execute/inFlightTracker';

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

describe('RequestCodeLensProvider', () => {
  const provider = new RequestCodeLensProvider();

  it('returns [] for non-apicircle documents', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('file:///foo.yaml'), ['name: x', 'method: GET']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('returns [] for apicircle URIs that are not .req.yaml', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/responses/r.run.yaml'), ['name: x']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('emits ◆ field lenses on method / url / header / query / pathParam rows (#10)', () => {
    const REQ = Uri.parse('apicircle://x/requests/abc.req.yaml');
    const lenses = provider.provideCodeLenses(
      makeDoc(REQ, [
        'name: List users',
        'method: GET',
        'url: https://x.com/users/{id}',
        'pathParams:',
        "  id: '1'",
        'query:',
        '  - key: page',
        "    value: '1'",
        '    enabled: true',
        'headers:',
        '  - key: Accept',
        '    value: application/json',
        '    enabled: true',
      ]),
      fakeToken,
    );
    const find = (cmd: string) => lenses.find((l) => l.command?.command === cmd);
    expect(find('apicircle.setRequestMethodField')?.command?.arguments).toEqual([REQ, 1]);
    expect(find('apicircle.setRequestTextField')?.command?.arguments).toEqual([REQ, 2]); // url:
    // header key/value are catalogue-aware commands.
    const headerKey = lenses.find(
      (l) => l.command?.command === 'apicircle.setRequestHeaderKeyField',
    );
    const headerValue = lenses.find(
      (l) => l.command?.command === 'apicircle.setRequestHeaderValueField',
    );
    expect(headerKey?.command?.arguments).toEqual([REQ, 10]); // - key: Accept
    expect(headerValue?.command?.arguments).toEqual([REQ, 11]); // value: application/json
    // query key + value + path-param value all route to the generic text editor.
    const textLines = lenses
      .filter((l) => l.command?.command === 'apicircle.setRequestTextField')
      .map((l) => l.command?.arguments?.[1]);
    expect(textLines).toContain(4); // pathParams id value
    expect(textLines).toContain(6); // query - key: page
    expect(textLines).toContain(7); // query value
  });

  it('emits ◆ editors on auth / assertions / extractions rows + graphql variables format', () => {
    const REQ = Uri.parse('apicircle://x/requests/abc.req.yaml');
    const lenses = provider.provideCodeLenses(
      makeDoc(REQ, [
        'name: R',
        'method: POST',
        'url: https://x.com',
        'auth:',
        '  type: api-key',
        '  key: X-Api-Key',
        '  value: secret',
        '  addTo: header',
        'assertions:',
        '  - id: a1',
        '    kind: status',
        '    op: equals',
        '    expected: 200',
        'extractions:',
        '  - id: e1',
        '    variable: token',
        '    source: body',
        '    path: $.token',
        '    enabled: true',
        'body:',
        '  type: graphql',
        '  content: query {}',
        "  variables: '{}'",
      ]),
      fakeToken,
    );
    const cmds = lenses.map((l) => l.command?.command);
    // auth: scalar fields are edited directly in the YAML — no per-field ◆ lens.
    expect(cmds).not.toContain('apicircle.setRequestAuthField');
    // assertions
    expect(cmds).toContain('apicircle.setRequestAssertionKindField');
    expect(cmds).toContain('apicircle.setRequestAssertionOpField');
    // extractions
    expect(cmds).toContain('apicircle.setRequestExtractionSourceField');
    // graphql variables → Format JSON on the variables: row (line 22)
    const fmt = lenses.find((l) => l.command?.command === 'apicircle.formatJson');
    expect(fmt?.command?.arguments).toEqual([REQ, 22]);
  });

  it('emits Send + Add-section + New-from-template lenses at the name: line', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        '# comment',
        'name: Get user',
        'method: GET',
        'url: https://x.com',
      ]),
      fakeToken,
    );
    // The name-row trio (other lenses are the ◆ method/url field editors).
    const nameRow = lenses.filter((l) => l.range.start.line === 1);
    expect(nameRow).toHaveLength(3);
    expect(nameRow[0].command?.title).toBe('▶ Send');
    expect(nameRow[0].command?.command).toBe('apicircle.sendRequest');
    expect(nameRow[1].command?.title).toBe('✚ Add section…');
    expect(nameRow[1].command?.command).toBe('apicircle.addRequestSection');
    expect(nameRow[2].command?.title).toBe('⤵ New from template…');
    expect(nameRow[2].command?.command).toBe('apicircle.newRequestFromTemplate');
  });

  it('only emits one row of lenses even if name: appears in comments or strings later', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: x',
        'description: "the name: in this comment shouldn\'t fire"',
        'name: nope',
      ]),
      fakeToken,
    );
    // 3 lenses share one anchor line — no second row.
    expect(lenses).toHaveLength(3);
    expect(lenses.every((l) => l.range.start.line === 0)).toBe(true);
  });

  it('returns [] when no name: line is present', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), ['# no name field']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('emits a Switch body type lens above body: with the current type in the title', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: Post user',
        'method: POST',
        'url: https://x.com',
        'body:',
        '  type: json',
        '  content: "{}"',
      ]),
      fakeToken,
    );
    const bodyLens = lenses.find(
      (l) => (l.command?.command ?? '') === 'apicircle.switchRequestBodyType',
    );
    expect(bodyLens).toBeDefined();
    expect(bodyLens?.command?.title).toContain('Switch body type');
    expect(bodyLens?.command?.title).toContain('json');
    // Anchored above the body: line (index 3).
    expect(bodyLens?.range.start.line).toBe(3);
    // ⟳ Format JSON lands on the content: row (index 5).
    const fmt = lenses.find((l) => l.command?.command === 'apicircle.formatJson');
    expect(fmt?.command?.arguments).toEqual([Uri.parse('apicircle://x/requests/abc.req.yaml'), 5]);
  });

  it('emits a Switch auth type lens above auth: with the current type in the title', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: Get me',
        'method: GET',
        'url: https://x.com',
        'auth:',
        '  type: bearer',
        '  token: ABC',
      ]),
      fakeToken,
    );
    const authLens = lenses.find(
      (l) => (l.command?.command ?? '') === 'apicircle.switchRequestAuthType',
    );
    expect(authLens).toBeDefined();
    expect(authLens?.command?.title).toContain('Switch auth type');
    expect(authLens?.command?.title).toContain('bearer');
    expect(authLens?.range.start.line).toBe(3);
  });

  it('omits the body / auth lenses when those sections are absent', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: Get me',
        'method: GET',
        'url: https://x.com',
      ]),
      fakeToken,
    );
    expect(
      lenses.find((l) => l.command?.command === 'apicircle.switchRequestBodyType'),
    ).toBeUndefined();
    expect(
      lenses.find((l) => l.command?.command === 'apicircle.switchRequestAuthType'),
    ).toBeUndefined();
  });

  it('falls back to a bare title when the body section has no type: child', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: X',
        'body:',
        '  content: "raw"',
      ]),
      fakeToken,
    );
    const bodyLens = lenses.find((l) => l.command?.command === 'apicircle.switchRequestBodyType');
    expect(bodyLens).toBeDefined();
    // No "(current: …)" suffix because no type was readable.
    expect(bodyLens?.command?.title).toBe('⇄ Switch body type…');
  });

  it('emits a "Pick attachment file" lens when body.type is binary', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: X',
        'body:',
        '  type: binary',
        '  content: ""',
      ]),
      fakeToken,
    );
    const pick = lenses.find((l) => l.command?.command === 'apicircle.pickBinaryAttachment');
    expect(pick).toBeDefined();
    expect(pick?.command?.title).toContain('Pick attachment file');
  });

  it('does NOT emit the binary-pick lens when body.type is something else', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: X',
        'body:',
        '  type: json',
        '  content: "{}"',
      ]),
      fakeToken,
    );
    expect(
      lenses.find((l) => l.command?.command === 'apicircle.pickBinaryAttachment'),
    ).toBeUndefined();
  });

  it('anchors Add text / Add file row lenses on the formRows: line, with no global switch lens', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: X', // 0
        'body:', // 1
        '  type: form-data', // 2
        '  formRows: []', // 3
      ]),
      fakeToken,
    );
    const addTextLens = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.addFormDataRow' &&
        (l.command?.arguments?.[1] as string) === 'text',
    );
    const addFileLens = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.addFormDataRow' &&
        (l.command?.arguments?.[1] as string) === 'file',
    );
    expect(addTextLens, 'Add text row lens missing').toBeDefined();
    expect(addFileLens, 'Add file row lens missing').toBeDefined();
    // Both anchor on the formRows: line (index 3), inside the body block — not
    // on the body: line (index 1).
    expect(addTextLens!.range.start.line).toBe(3);
    expect(addFileLens!.range.start.line).toBe(3);
    // The global "⇄ Switch row kind…" lens (no row index) is gone — switching
    // is per-row only (see the per-row test below).
    const globalSwitchKind = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.switchFormDataRowKind' &&
        (l.command?.arguments?.length ?? 0) === 1,
    );
    expect(globalSwitchKind, 'global Switch row kind lens should be removed').toBeUndefined();
  });

  it('emits per-row lenses inside formRows: with the row index baked in', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: X',
        'body:',
        '  type: form-data',
        '  formRows:',
        '    - kind: text',
        '      key: name',
        '      value: Alice',
        '      enabled: true',
        '    - kind: file',
        '      key: avatar',
        '      slotId: abc',
        '      enabled: true',
      ]),
      fakeToken,
    );
    const switchRow0 = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.switchFormDataRowKind' &&
        (l.command?.arguments?.[1] as number) === 0,
    );
    const switchRow1 = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.switchFormDataRowKind' &&
        (l.command?.arguments?.[1] as number) === 1,
    );
    expect(switchRow0?.command?.title).toBe('↻ Switch to file');
    expect(switchRow1?.command?.title).toBe('↻ Switch to text');
    const pickRow1 = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.pickFormDataRowFile' &&
        (l.command?.arguments?.[1] as number) === 1,
    );
    expect(pickRow1, 'file row should expose Pick file lens').toBeDefined();
    // A text row should NOT have a Pick file lens.
    expect(
      lenses.find(
        (l) =>
          l.command?.command === 'apicircle.pickFormDataRowFile' &&
          (l.command?.arguments?.[1] as number) === 0,
      ),
    ).toBeUndefined();
  });

  it('emits a "Pick header" lens above headers:', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: X',
        'headers:',
        '  - key: Accept',
        '    value: application/json',
        '    enabled: true',
      ]),
      fakeToken,
    );
    const lens = lenses.find((l) => l.command?.command === 'apicircle.pickHeader');
    expect(lens).toBeDefined();
    expect(lens?.range.start.line).toBe(1);
  });

  it('emits a "Map from JSON" lens above contextVars:', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: X',
        'contextVars:',
        '  - key: scope',
        '    value: read',
      ]),
      fakeToken,
    );
    const lens = lenses.find((l) => l.command?.command === 'apicircle.mapContextVarsFromJson');
    expect(lens).toBeDefined();
    expect(lens?.range.start.line).toBe(1);
  });

  it('emits a "Get token" lens above auth: when type is an OAuth2 grant', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: X',
        'auth:',
        '  type: oauth2-client-credentials',
        '  tokenUrl: https://idp.example.com/oauth/token',
      ]),
      fakeToken,
    );
    const lens = lenses.find((l) => l.command?.command === 'apicircle.fetchOAuth2Token');
    expect(lens).toBeDefined();
  });

  it('does NOT emit the "Get token" lens for non-OAuth2 auth types', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: X',
        'auth:',
        '  type: bearer',
        '  token: ABC',
      ]),
      fakeToken,
    );
    expect(lenses.find((l) => l.command?.command === 'apicircle.fetchOAuth2Token')).toBeUndefined();
  });

  it('refresh() fires the onDidChangeCodeLenses event', () => {
    const p = new RequestCodeLensProvider();
    let fired = false;
    p.onDidChangeCodeLenses(() => (fired = true));
    p.refresh();
    expect(fired).toBe(true);
    p.dispose();
  });

  describe('in-flight tracker integration', () => {
    it('swaps the ▶ Send row for ⏳ Sending… + ✖ Cancel while in flight', () => {
      const tracker = new InFlightSendTracker();
      const p = new RequestCodeLensProvider(tracker);
      const uri = Uri.parse('apicircle://x/requests/Login.req.yaml?id=req_1');

      tracker.start(uri as never, 'run_1', 'Login');

      const lenses = p.provideCodeLenses(
        makeDoc(uri, ['name: Login', 'method: GET', 'url: https://x.com']),
        fakeToken,
      );
      // The name-row in-flight pair is ⏳ Sending… + ✖ Cancel (both routing to
      // cancelOneSend); the ◆ field lenses on method/url rows are separate.
      const nameRow = lenses.filter((l) => l.command?.command === 'apicircle.cancelOneSend');
      expect(nameRow).toHaveLength(2);
      expect(nameRow[0].command?.title).toMatch(/^⏳ Sending…/);
      expect(nameRow[1].command?.title).toBe('✖ Cancel');
      expect(lenses.find((l) => l.command?.title === '▶ Send')).toBeUndefined();
      p.dispose();
      tracker.dispose();
    });

    it('reverts to the default ▶ Send row once the tracker releases the URI', () => {
      const tracker = new InFlightSendTracker();
      const p = new RequestCodeLensProvider(tracker);
      const uri = Uri.parse('apicircle://x/requests/Login.req.yaml?id=req_1');

      tracker.start(uri as never, 'run_1', 'Login');
      tracker.end(uri as never);

      const lenses = p.provideCodeLenses(makeDoc(uri, ['name: Login']), fakeToken);
      expect(lenses.find((l) => l.command?.title === '▶ Send')).toBeDefined();
      expect(lenses.find((l) => l.command?.title?.startsWith('⏳'))).toBeUndefined();
      p.dispose();
      tracker.dispose();
    });

    it('refreshes lenses when the tracker fires its change event', () => {
      const tracker = new InFlightSendTracker();
      const p = new RequestCodeLensProvider(tracker);
      let fired = 0;
      p.onDidChangeCodeLenses(() => (fired += 1));
      tracker.start(Uri.parse('apicircle://x/requests/a.req.yaml?id=1') as never, 'r1', 'a');
      tracker.end(Uri.parse('apicircle://x/requests/a.req.yaml?id=1') as never);
      expect(fired).toBeGreaterThanOrEqual(2);
      p.dispose();
      tracker.dispose();
    });
  });
});
