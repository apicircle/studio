import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockEndpoint } from '@apicircle/shared';
import {
  Uri,
  Range,
  window,
  workspace,
  applyRecordedEdits,
  type WorkspaceEdit,
} from '../../test/mocks/vscode';
import { serializeEndpointToYaml, parseEndpointFromYaml } from '../fs/endpointYaml';
import {
  setMockMethodFieldCommand,
  setMockStatusFieldCommand,
  setMockBodyTypeFieldCommand,
  setMockHeaderKeyFieldCommand,
  setMockHeaderValueFieldCommand,
  setMockClauseScopeFieldCommand,
  setMockClauseOpFieldCommand,
  setMockClauseTargetFieldCommand,
  setMockClauseValueFieldCommand,
  toggleMockHeaderEnabledCommand,
  addMockConditionClauseCommand,
  setMockMultiplierKindFieldCommand,
  setMockMultiplierKeyFieldCommand,
  setMockMultiplierTargetPathFieldCommand,
  setMockNumberFieldCommand,
} from './mockFieldEdits';
import {
  addMockMultiplierCommand,
  removeMockMultiplierCommand,
  switchMockResponseBodyTypeCommand,
  addMockResponseHeaderCommand,
} from './mockEndpointEdits';

// =============================================================================
// Command-level integration tests: each command opens an editable in-memory
// endpoint YAML, the picker is stubbed, the WorkspaceEdit is applied to the
// text (mirroring the host), and we assert the RESULT re-parses to the
// expected MockEndpoint. This exercises the real parse → pick → edit → save →
// re-parse round-trip that the pure-helper tests don't.
// =============================================================================

const URI = Uri.parse('apicircle://x/mocks/m-1/ep-1.endpoint.yaml');

function makeEndpoint(): MockEndpoint {
  return {
    id: 'ep-1',
    name: 'List pets',
    method: 'GET',
    pathPattern: '/pets',
    requestSchema: {
      pathParams: [],
      queryParams: [{ id: 'q1', name: 'page' }],
      headers: [],
      cookies: [],
    },
    requestValidation: [],
    responseRules: [
      {
        id: 'r1',
        name: 'Rule 1',
        enabled: true,
        when: [{ id: 'c1', scope: 'query', target: 'page', op: 'equals', value: '1' }],
        response: {
          status: 200,
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
          body: { type: 'json', content: '{"ok":true}' },
        },
      },
    ],
    defaultResponse: {
      status: 200,
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: { type: 'json', content: '{"items":[{"id":1}]}' },
      multipliers: [
        {
          id: 'm1',
          name: 'page size',
          source: { kind: 'query', key: 'pageSize' },
          targetJsonPath: '$.items',
          defaultCount: 10,
          min: 1,
          max: 50,
        },
      ],
    },
  };
}

/** Wire an editable doc + the apply pipeline; returns a live text getter. */
function mountDoc(initial: string): { get: () => string } {
  let text = initial;
  const doc = {
    uri: URI,
    get lineCount(): number {
      return text.split('\n').length;
    },
    getText: () => text,
    lineAt: (line: number) => {
      const l = text.split('\n')[line] ?? '';
      return { text: l, range: new Range(line, 0, line, l.length) };
    },
    save: vi.fn(async () => undefined),
  };
  (workspace.openTextDocument as Mock).mockResolvedValue(doc);
  (window.showTextDocument as Mock).mockResolvedValue({
    selection: undefined,
    revealRange: vi.fn(),
  });
  (workspace.applyEdit as Mock).mockImplementation(async (e: WorkspaceEdit) => {
    text = applyRecordedEdits(text, e.edits);
    return true;
  });
  return { get: () => text };
}

/** First line index (0-based) matching `re`, optionally after an anchor line. */
function lineOf(text: string, re: RegExp, afterRe?: RegExp): number {
  const lines = text.split('\n');
  let from = 0;
  if (afterRe) {
    from = lines.findIndex((l) => afterRe.test(l));
    if (from === -1) return -1;
  }
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  return -1;
}

function parse(text: string): MockEndpoint {
  return { id: 'ep-1', ...parseEndpointFromYaml(text).endpoint };
}

beforeEach(() => {
  (window.showQuickPick as Mock).mockReset();
  (window.showInputBox as Mock).mockReset();
  (window.showInformationMessage as Mock).mockReset();
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (workspace.openTextDocument as Mock).mockReset();
  (workspace.applyEdit as Mock).mockReset();
  (window.showTextDocument as Mock).mockReset();
  (window.activeTextEditor as unknown) = undefined;
});

describe('field editors — scalar pickers', () => {
  it('setMockMethodField replaces the method', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    (window.showQuickPick as Mock).mockResolvedValueOnce('POST');
    await setMockMethodFieldCommand(URI, lineOf(h.get(), /^method:/));
    expect(parse(h.get()).method).toBe('POST');
  });

  it('setMockStatusField sets the default-response status', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    const line = lineOf(h.get(), /^\s+status:/, /^defaultResponse:/);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '404', code: 404 });
    await setMockStatusFieldCommand(URI, line);
    expect(parse(h.get()).defaultResponse.status).toBe(404);
  });

  it('setMockStatusField → custom prompts an input box', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    const line = lineOf(h.get(), /^\s+status:/, /^defaultResponse:/);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'Custom…', code: null });
    (window.showInputBox as Mock).mockResolvedValueOnce('418');
    await setMockStatusFieldCommand(URI, line);
    expect(parse(h.get()).defaultResponse.status).toBe(418);
  });

  it('setMockHeaderKeyField + ValueField edit a header row (value catalogue is header-aware)', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    const keyLine = lineOf(h.get(), /^\s+-\s+key:/, /^defaultResponse:/);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'Cache-Control',
      value: 'Cache-Control',
    });
    await setMockHeaderKeyFieldCommand(URI, keyLine);
    expect(parse(h.get()).defaultResponse.headers[0].key).toBe('Cache-Control');

    const valLine = lineOf(h.get(), /^\s+value:/, /^defaultResponse:/);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'no-store', value: 'no-store' });
    await setMockHeaderValueFieldCommand(URI, valLine);
    expect(parse(h.get()).defaultResponse.headers[0].value).toBe('no-store');
  });
});

describe('field editors — body type + Content-Type reconcile (#6)', () => {
  it('switching the default body to XML rewrites the subtree AND syncs Content-Type', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    const typeLine = lineOf(h.get(), /^\s+type:/, /^defaultResponse:/);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'XML', value: 'xml' });
    await setMockBodyTypeFieldCommand(URI, typeLine);
    const ep = parse(h.get());
    expect(ep.defaultResponse.body.type).toBe('xml');
    expect(ep.defaultResponse.headers.find((x) => x.key === 'Content-Type')?.value).toBe(
      'application/xml',
    );
  });

  it('switching to none drops the Content-Type header', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    const typeLine = lineOf(h.get(), /^\s+type:/, /^defaultResponse:/);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'None', value: 'none' });
    await setMockBodyTypeFieldCommand(URI, typeLine);
    const ep = parse(h.get());
    expect(ep.defaultResponse.body.type).toBe('none');
    expect(ep.defaultResponse.headers.find((x) => x.key === 'Content-Type')).toBeUndefined();
  });
});

describe('field editors — response-rule when clauses', () => {
  it('scope / op / target / value pickers edit the clause', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'Header', value: 'header' });
    await setMockClauseScopeFieldCommand(URI, lineOf(h.get(), /^\s+scope:/));
    expect(parse(h.get()).responseRules[0].when[0].scope).toBe('header');

    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'matches', value: 'matches' });
    await setMockClauseOpFieldCommand(URI, lineOf(h.get(), /^\s+op:/));
    expect(parse(h.get()).responseRules[0].when[0].op).toBe('matches');

    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'X-Tier', value: 'X-Tier' });
    await setMockClauseTargetFieldCommand(URI, lineOf(h.get(), /^\s+target:/, /^responseRules:/));
    expect(parse(h.get()).responseRules[0].when[0].target).toBe('X-Tier');

    // The clause value editor offers curated values for header scope; here the
    // scope is header (set above) + target X-Tier has no catalogue → free text.
    (window.showInputBox as Mock).mockResolvedValueOnce('premium');
    await setMockClauseValueFieldCommand(URI, lineOf(h.get(), /^\s+value:/, /\s+when:/));
    expect(parse(h.get()).responseRules[0].when[0].value).toBe('premium');
  });

  it('addMockConditionClause refuses a 2nd clause at the cap (MAX_RESPONSE_RULE_CONDITIONS=1)', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    // The rule already carries one clause → the cap blocks adding another.
    await addMockConditionClauseCommand(URI, lineOf(h.get(), /^\s+when:/));
    expect(parse(h.get()).responseRules[0].when).toHaveLength(1);
    expect((window.showInformationMessage as Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it('addMockConditionClause adds the first clause to an empty when: []', async () => {
    const ep = makeEndpoint();
    ep.responseRules[0].when = [];
    const h = mountDoc(serializeEndpointToYaml(ep));
    await addMockConditionClauseCommand(URI, lineOf(h.get(), /^\s+when:/));
    expect(parse(h.get()).responseRules[0].when).toHaveLength(1);
  });
});

describe('field editors — header enable/disable toggle', () => {
  it('toggleMockHeaderEnabled flips an explicit enabled: true → false', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    const keyLine = lineOf(h.get(), /^\s+-\s+key:/, /^defaultResponse:/);
    await toggleMockHeaderEnabledCommand(URI, keyLine);
    const ep = parse(h.get());
    expect(ep.defaultResponse.headers[0].enabled).toBe(false);
  });
});

describe('field editors — multiplier', () => {
  it('kind / key / path / count / min pickers edit the multiplier', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'Header', value: 'header' });
    await setMockMultiplierKindFieldCommand(URI, lineOf(h.get(), /^\s+kind:/, /^\s+multipliers:/));
    expect(parse(h.get()).defaultResponse.multipliers![0].source.kind).toBe('header');

    (window.showInputBox as Mock).mockResolvedValueOnce('X-Page-Size');
    await setMockMultiplierKeyFieldCommand(URI, lineOf(h.get(), /^\s+key:/, /^\s+multipliers:/));
    expect(parse(h.get()).defaultResponse.multipliers![0].source.key).toBe('X-Page-Size');

    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '$.items', value: '$.items' });
    await setMockMultiplierTargetPathFieldCommand(URI, lineOf(h.get(), /^\s+targetJsonPath:/));
    expect(parse(h.get()).defaultResponse.multipliers![0].targetJsonPath).toBe('$.items');

    (window.showInputBox as Mock).mockResolvedValueOnce('25');
    await setMockNumberFieldCommand(URI, lineOf(h.get(), /^\s+defaultCount:/));
    expect(parse(h.get()).defaultResponse.multipliers![0].defaultCount).toBe(25);

    (window.showInputBox as Mock).mockResolvedValueOnce('3');
    await setMockNumberFieldCommand(URI, lineOf(h.get(), /^\s+min:/));
    expect(parse(h.get()).defaultResponse.multipliers![0].min).toBe(3);
  });

  it('addMockMultiplier appends one, then refuses a second (cap = 1)', async () => {
    // Start with no multipliers.
    const ep = makeEndpoint();
    ep.defaultResponse.multipliers = undefined;
    const h = mountDoc(serializeEndpointToYaml(ep));
    await addMockMultiplierCommand(URI);
    expect(parse(h.get()).defaultResponse.multipliers).toHaveLength(1);

    // Second add is blocked at the cap (info message, no change).
    await addMockMultiplierCommand(URI);
    expect(parse(h.get()).defaultResponse.multipliers).toHaveLength(1);
    expect(window.showInformationMessage as Mock).toHaveBeenCalled();
  });

  it('removeMockMultiplier removes the entry by id', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    await removeMockMultiplierCommand(URI, 'm1');
    expect(parse(h.get()).defaultResponse.multipliers).toBeUndefined();
  });
});

describe('old commands — nested-indent fix (#1)', () => {
  it('switchMockResponseBodyType on the default response yields VALID YAML', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'Text', value: 'text' });
    await switchMockResponseBodyTypeCommand(URI); // default (no ruleId) — the old indent=4 bug
    // The whole point: the result re-parses (a mis-indented body: would throw).
    const ep = parse(h.get());
    expect(ep.defaultResponse.body.type).toBe('text');
    expect(ep.defaultResponse.headers.find((x) => x.key === 'Content-Type')?.value).toBe(
      'text/plain',
    );
  });

  it('addMockResponseHeader on a response RULE lands the row at the right depth', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ label: 'ETag', value: 'ETag' }) // header name
      .mockResolvedValueOnce({ label: '"{{etag}}"', value: '"{{etag}}"' }); // value
    await addMockResponseHeaderCommand(URI, 'r1');
    const ep = parse(h.get());
    // The new header belongs to rule r1's response, not the default response.
    expect(ep.responseRules[0].response.headers.some((x) => x.key === 'ETag')).toBe(true);
    expect(ep.defaultResponse.headers.some((x) => x.key === 'ETag')).toBe(false);
  });
});
