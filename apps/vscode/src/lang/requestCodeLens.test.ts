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

  it('returns [] for non-apicircle documents', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('file:///foo.yaml'), ['name: x', 'method: GET']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('returns [] for apicircle URIs that are not .yaml', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/responses/r.yaml'), ['name: x']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('emits ◆ field lenses on method / header / query / pathParam rows but NOT on url:', async () => {
    const REQ = Uri.parse('apicircle://x/requests/abc.yaml');
    const lenses = await provider.provideCodeLenses(
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
    // The url: row gets no field lens — it's edited inline; ?query and {path}
    // placeholders sync into the query: / pathParams: blocks on save.
    const onUrlLine = lenses.filter((l) => l.range.start.line === 2);
    expect(onUrlLine).toEqual([]);
    // header key/value are catalogue-aware commands.
    const headerKey = lenses.find(
      (l) => l.command?.command === 'apicircle.setRequestHeaderKeyField',
    );
    const headerValue = lenses.find(
      (l) => l.command?.command === 'apicircle.setRequestHeaderValueField',
    );
    expect(headerKey?.command?.arguments).toEqual([REQ, 10]); // - key: Accept
    expect(headerValue?.command?.arguments).toEqual([REQ, 11]); // value: application/json
    // query key + path-param value route to the generic text editor. The
    // query VALUE row no longer carries a ◆ Value lens (edited inline; the
    // URL bar's ?key=val syntax round-trips on save). The query KEY row
    // gains a ✓/⊘ enable toggle alongside ◆ Key.
    const textLines = lenses
      .filter((l) => l.command?.command === 'apicircle.setRequestTextField')
      .map((l) => l.command?.arguments?.[1]);
    expect(textLines).not.toContain(2); // not on url:
    expect(textLines).toContain(4); // pathParams id value
    expect(textLines).toContain(6); // query - key: page
    expect(textLines).not.toContain(7); // query value lens removed
    const toggle = lenses.find(
      (l) =>
        l.command?.command === 'apicircle.toggleRequestRowEnabled' &&
        (l.command?.arguments?.[1] as number) === 6,
    );
    expect(toggle).toBeDefined();
  });

  it('emits ◆ editors on auth / assertions / extractions rows + graphql variables format', async () => {
    const REQ = Uri.parse('apicircle://x/requests/abc.yaml');
    const lenses = await provider.provideCodeLenses(
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

  it('emits Send + Add-section + New-from-template lenses at the name: line', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
        '# comment',
        'name: Get user',
        'method: GET',
        'url: https://x.com',
      ]),
      fakeToken,
    );
    // The name-row trio (other lenses are the ◆ method/url field editors).
    // The Send lens title was upgraded to a more visible CTA so first-time
    // users notice it and learn the Ctrl/Cmd+Enter shortcut.
    const nameRow = lenses.filter((l) => l.range.start.line === 1);
    expect(nameRow).toHaveLength(3);
    expect(nameRow[0].command?.title).toMatch(/^▶▶ SEND REQUEST/);
    expect(nameRow[0].command?.command).toBe('apicircle.sendRequest');
    expect(nameRow[1].command?.title).toBe('✚ Add section…');
    expect(nameRow[1].command?.command).toBe('apicircle.addRequestSection');
    expect(nameRow[2].command?.title).toBe('⤵ New from template…');
    expect(nameRow[2].command?.command).toBe('apicircle.newRequestFromTemplate');
  });

  it('only emits one row of lenses even if name: appears in comments or strings later', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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

  it('returns [] when no name: line is present', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), ['# no name field']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('emits a Switch body type lens above body: with the current type in the title', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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
    expect(fmt?.command?.arguments).toEqual([Uri.parse('apicircle://x/requests/abc.yaml'), 5]);
  });

  it('emits a Switch auth type lens above auth: with the current type in the title', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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

  it('omits the body / auth lenses when those sections are absent', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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

  it('falls back to a bare title when the body section has no type: child', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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

  it('emits a "Pick attachment file" lens when body.type is binary', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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

  it('does NOT emit the binary-pick lens when body.type is something else', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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

  it('anchors Add text / Add file row lenses on the formRows: line, with no global switch lens', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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

  it('emits per-row lenses inside formRows: with the row index baked in', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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

  it('emits a "Pick header" lens above headers:', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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

  it('emits a "Map from JSON" lens above contextVars:', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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

  it('emits a "Get token" lens above auth: when type is an OAuth2 grant', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
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

  it('does NOT emit the "Get token" lens for non-OAuth2 auth types', async () => {
    const lenses = await provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), [
        'name: X',
        'auth:',
        '  type: bearer',
        '  token: ABC',
      ]),
      fakeToken,
    );
    expect(lenses.find((l) => l.command?.command === 'apicircle.fetchOAuth2Token')).toBeUndefined();
  });

  it('refresh() fires the onDidChangeCodeLenses event', async () => {
    const p = new RequestCodeLensProvider();
    let fired = false;
    p.onDidChangeCodeLenses(() => (fired = true));
    p.refresh();
    expect(fired).toBe(true);
    p.dispose();
  });

  describe('inherited-auth lens', () => {
    // Minimal bridge stub — we only need listWorkspaces() returning a
    // surface whose read() yields a state with the requested folder chain.
    function makeBridgeStub(opts: {
      workspaceId: string;
      requestId: string;
      folderId: string | null;
      folders: Record<
        string,
        { id: string; name: string; parentId: string | null; auth?: unknown }
      >;
    }) {
      const state = {
        synced: {
          collections: {
            requests: {
              [opts.requestId]: {
                id: opts.requestId,
                folderId: opts.folderId,
              },
            },
            folders: opts.folders,
          },
        },
        local: {},
      } as never;
      const surface = {
        workspace: { id: opts.workspaceId },
        read: async () => state,
      };
      return {
        listWorkspaces: () => [surface],
        onDidChangeActiveWorkspace: () => ({ dispose: () => undefined }),
      } as never;
    }

    function authReqUri(workspaceId: string, requestId: string): unknown {
      const enc = Buffer.from(workspaceId, 'utf8').toString('hex');
      return Uri.parse(`apicircle://${enc}/requests/abc.yaml?id=${requestId}`);
    }

    it('surfaces "Inherits from <Folder> (<type>)" when an ancestor sets auth', async () => {
      const wsId = '/test/.apicircle';
      const reqId = 'req_inh_1';
      const uri = authReqUri(wsId, reqId);
      const bridge = makeBridgeStub({
        workspaceId: wsId,
        requestId: reqId,
        folderId: 'fChild',
        folders: {
          fParent: {
            id: 'fParent',
            name: 'Authenticated',
            parentId: null,
            auth: { type: 'bearer', token: 'tok' },
          },
          fChild: { id: 'fChild', name: 'Users', parentId: 'fParent' },
        },
      });
      const p = new RequestCodeLensProvider(undefined, bridge);
      const lenses = await p.provideCodeLenses(
        makeDoc(uri, ['name: X', 'auth:', '  type: inherit']),
        fakeToken,
      );
      const lens = lenses.find((l) => l.command?.title?.startsWith('◆ Inherits from'));
      expect(lens).toBeDefined();
      expect(lens?.command?.title).toBe('◆ Inherits from Authenticated (bearer)');
      expect(lens?.command?.command).toBe('vscode.open');
      // arguments[0] is the folder URI — base path includes /folders/<name>.yaml
      const folderUri = lens?.command?.arguments?.[0] as { path: string; query: string };
      expect(folderUri.path).toBe('/folders/Authenticated.yaml');
      expect(folderUri.query).toBe('id=fParent');
      p.dispose();
    });

    it('surfaces "Inherits → none" when no ancestor sets auth', async () => {
      const wsId = '/test/.apicircle';
      const reqId = 'req_inh_2';
      const uri = authReqUri(wsId, reqId);
      const bridge = makeBridgeStub({
        workspaceId: wsId,
        requestId: reqId,
        folderId: 'fA',
        folders: {
          fA: { id: 'fA', name: 'Root', parentId: null },
        },
      });
      const p = new RequestCodeLensProvider(undefined, bridge);
      const lenses = await p.provideCodeLenses(
        makeDoc(uri, ['name: X', 'auth:', '  type: inherit']),
        fakeToken,
      );
      const lens = lenses.find((l) => l.command?.title?.startsWith('◆ Inherits'));
      expect(lens?.command?.title).toBe('◆ Inherits → none (no ancestor folder sets auth)');
      p.dispose();
    });

    it('emits no inherited-auth lens for non-inherit auth types', async () => {
      const wsId = '/test/.apicircle';
      const reqId = 'req_inh_3';
      const uri = authReqUri(wsId, reqId);
      const bridge = makeBridgeStub({
        workspaceId: wsId,
        requestId: reqId,
        folderId: null,
        folders: {},
      });
      const p = new RequestCodeLensProvider(undefined, bridge);
      const lenses = await p.provideCodeLenses(
        makeDoc(uri, ['name: X', 'auth:', '  type: bearer', '  token: ABC']),
        fakeToken,
      );
      expect(lenses.find((l) => l.command?.title?.startsWith('◆ Inherits'))).toBeUndefined();
      p.dispose();
    });

    it('refreshes when the fsProvider reports a folder YAML change', () => {
      const listeners: Array<(events: { uri: { scheme: string; path: string } }[]) => void> = [];
      const fsProvider = {
        onDidChangeFile: (
          listener: (events: { uri: { scheme: string; path: string } }[]) => void,
        ) => {
          listeners.push(listener);
          return { dispose: () => undefined };
        },
      };
      const p = new RequestCodeLensProvider(undefined, undefined, fsProvider as never);
      let fired = 0;
      p.onDidChangeCodeLenses(() => (fired += 1));
      // Folder YAML change → refresh.
      for (const l of listeners) l([{ uri: { scheme: 'apicircle', path: '/folders/Auth.yaml' } }]);
      expect(fired).toBe(1);
      // Non-folder change (e.g. mocks) → no refresh.
      for (const l of listeners) l([{ uri: { scheme: 'apicircle', path: '/mocks/x.yaml' } }]);
      expect(fired).toBe(1);
      p.dispose();
    });

    it('refreshes when the active workspace changes', () => {
      const triggers: Array<() => void> = [];
      const bridge = {
        listWorkspaces: () => [],
        onDidChangeActiveWorkspace: (l: () => void) => {
          triggers.push(l);
          return { dispose: () => undefined };
        },
      } as never;
      const p = new RequestCodeLensProvider(undefined, bridge);
      let fired = 0;
      p.onDidChangeCodeLenses(() => (fired += 1));
      for (const t of triggers) t();
      expect(fired).toBe(1);
      p.dispose();
    });

    it('resolves against linkedCollections when the URI is a /linked/.../*.yaml', async () => {
      const wsId = '/test/.apicircle';
      const reqId = 'lreq_1';
      const linkId = 'lw1';
      const enc = Buffer.from(wsId, 'utf8').toString('hex');
      const uri = Uri.parse(
        `apicircle://${enc}/linked/Payments/Login.yaml?link=${linkId}&id=${reqId}`,
      );
      const sourceFolder = {
        id: 'lf1',
        name: 'Linked Auth',
        parentId: null,
        auth: { type: 'bearer', token: 'src-tok' },
      };
      const state = {
        synced: {
          collections: { requests: {}, folders: {} },
          linkedWorkspaces: { [linkId]: { id: linkId, name: 'Payments' } },
        },
        local: {
          linkedCollections: {
            [linkId]: {
              collections: {
                requests: { [reqId]: { id: reqId, folderId: 'lf1' } },
                folders: { lf1: sourceFolder },
              },
            },
          },
        },
      } as never;
      const bridge = {
        listWorkspaces: () => [{ workspace: { id: wsId }, read: async () => state }],
        onDidChangeActiveWorkspace: () => ({ dispose: () => undefined }),
      } as never;
      const p = new RequestCodeLensProvider(undefined, bridge);
      const lenses = await p.provideCodeLenses(
        makeDoc(uri, ['name: X', 'auth:', '  type: inherit']),
        fakeToken,
      );
      const lens = lenses.find((l) => l.command?.title?.startsWith('◆ Inherits'));
      expect(lens?.command?.title).toBe('◆ Inherits from Linked Auth (bearer) [linked]');
      const target = lens?.command?.arguments?.[0] as { path: string };
      expect(target.path).toBe('/linked/Payments/Linked-Auth.yaml');
      p.dispose();
    });

    it('emits no lens when bridge is omitted (graceful degrade)', async () => {
      const uri = Uri.parse('apicircle://x/requests/abc.yaml?id=req_1');
      const p = new RequestCodeLensProvider();
      const lenses = await p.provideCodeLenses(
        makeDoc(uri, ['name: X', 'auth:', '  type: inherit']),
        fakeToken,
      );
      expect(lenses.find((l) => l.command?.title?.startsWith('◆ Inherits'))).toBeUndefined();
      p.dispose();
    });
  });

  describe('in-flight tracker integration', () => {
    it('swaps the ▶ Send row for ⏳ Sending… + ✖ Cancel while in flight', async () => {
      const tracker = new InFlightSendTracker();
      const p = new RequestCodeLensProvider(tracker);
      const uri = Uri.parse('apicircle://x/requests/Login.yaml?id=req_1');

      tracker.start(uri as never, 'run_1', 'Login');

      const lenses = await p.provideCodeLenses(
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

    it('reverts to the default Send row once the tracker releases the URI', async () => {
      const tracker = new InFlightSendTracker();
      const p = new RequestCodeLensProvider(tracker);
      const uri = Uri.parse('apicircle://x/requests/Login.yaml?id=req_1');

      tracker.start(uri as never, 'run_1', 'Login');
      tracker.end(uri as never);

      const lenses = await p.provideCodeLenses(makeDoc(uri, ['name: Login']), fakeToken);
      expect(lenses.find((l) => l.command?.title?.startsWith('▶▶ SEND'))).toBeDefined();
      expect(lenses.find((l) => l.command?.title?.startsWith('⏳'))).toBeUndefined();
      p.dispose();
      tracker.dispose();
    });

    it('refreshes lenses when the tracker fires its change event', async () => {
      const tracker = new InFlightSendTracker();
      const p = new RequestCodeLensProvider(tracker);
      let fired = 0;
      p.onDidChangeCodeLenses(() => (fired += 1));
      tracker.start(Uri.parse('apicircle://x/requests/a.yaml?id=1') as never, 'r1', 'a');
      tracker.end(Uri.parse('apicircle://x/requests/a.yaml?id=1') as never);
      expect(fired).toBeGreaterThanOrEqual(2);
      p.dispose();
      tracker.dispose();
    });
  });
});
