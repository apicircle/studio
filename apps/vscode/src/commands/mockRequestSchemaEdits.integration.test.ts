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
  addMockRequestSchemaCommand,
  addMockRequestSchemaParamCommand,
  addMockRequestSchemaBodyExampleCommand,
  setMockParamTypeFieldCommand,
  pathSlots,
  buildParamEntry,
  buildRequestSchemaBlock,
} from './mockRequestSchemaEdits';

// =============================================================================
// Integration tests: each command opens an editable endpoint YAML, applies its
// WorkspaceEdit to the text, and asserts the result re-parses to the expected
// MockEndpoint.requestSchema. Exercises the real parse → edit → re-parse loop.
// =============================================================================

const URI = Uri.parse('apicircle://x/mocks/m-1/get-pet.yaml?mockId=m-1&id=ep-1');

function makeEndpoint(overrides?: Partial<MockEndpoint>): MockEndpoint {
  return {
    id: 'ep-1',
    name: 'Get pet',
    method: 'GET',
    pathPattern: '/pets/{petId}',
    requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
    requestValidation: [],
    responseRules: [],
    defaultResponse: {
      status: 200,
      headers: [],
      body: { type: 'json', content: '{"ok":true}' },
    },
    ...overrides,
  };
}

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

function lineOf(text: string, re: RegExp): number {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i;
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

describe('pure helpers', () => {
  it('pathSlots extracts {slot} names', () => {
    expect(pathSlots('/pets/{petId}/owners/{ownerId}')).toEqual(['petId', 'ownerId']);
    expect(pathSlots('/pets')).toEqual([]);
  });

  it('buildParamEntry renders a 5-field entry at the dash indent', () => {
    const entry = buildParamEntry(4, { name: 'page', typeHint: 'integer', required: false });
    expect(entry).toContain('    - id:');
    expect(entry).toContain("      name: 'page'");
    expect(entry).toContain("      typeHint: 'integer'");
    expect(entry).toContain('      required: false');
  });

  it('buildRequestSchemaBlock seeds path params from slots', () => {
    const block = buildRequestSchemaBlock(['petId']);
    expect(block).toContain('requestSchema:');
    expect(block).toContain('  pathParams:');
    expect(block).toContain("      name: 'petId'");
    expect(block).toContain('  queryParams: []');
  });
});

describe('addMockRequestSchema — create block from pathPattern', () => {
  it('creates a requestSchema seeded with the path slot, round-trips', async () => {
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    await addMockRequestSchemaCommand(URI);
    const ep = parse(h.get());
    expect(ep.requestSchema.pathParams.map((p) => p.name)).toEqual(['petId']);
    expect(ep.requestSchema.pathParams[0].required).toBe(true);
  });
});

describe('addMockRequestSchemaParam — add to a list', () => {
  it('adds a query param to an existing (empty) schema', async () => {
    const h = mountDoc(
      serializeEndpointToYaml(
        makeEndpoint({
          requestSchema: {
            pathParams: [{ id: 'p1', name: 'petId' }],
            queryParams: [],
            headers: [],
            cookies: [],
          },
        }),
      ),
    );
    await addMockRequestSchemaParamCommand(URI, 'queryParams');
    const ep = parse(h.get());
    expect(ep.requestSchema.queryParams).toHaveLength(1);
  });

  it('creates the schema when absent, seeding the path slot for pathParams', async () => {
    // Endpoint has no requestSchema in the projection (all lists empty → hidden).
    const h = mountDoc(serializeEndpointToYaml(makeEndpoint()));
    expect(lineOf(h.get(), /^requestSchema:/)).toBe(-1);
    await addMockRequestSchemaParamCommand(URI, 'pathParams');
    const ep = parse(h.get());
    expect(ep.requestSchema.pathParams.map((p) => p.name)).toEqual(['petId']);
  });

  it('appends a 2nd header to a populated list', async () => {
    const h = mountDoc(
      serializeEndpointToYaml(
        makeEndpoint({
          requestSchema: {
            pathParams: [],
            queryParams: [],
            headers: [{ id: 'h1', name: 'Authorization' }],
            cookies: [],
          },
        }),
      ),
    );
    await addMockRequestSchemaParamCommand(URI, 'headers');
    const ep = parse(h.get());
    expect(ep.requestSchema.headers).toHaveLength(2);
    expect(ep.requestSchema.headers[0].name).toBe('Authorization');
  });
});

describe('addMockRequestSchemaBodyExample', () => {
  it('adds body docs to an existing schema', async () => {
    const h = mountDoc(
      serializeEndpointToYaml(
        makeEndpoint({
          requestSchema: {
            pathParams: [{ id: 'p1', name: 'petId' }],
            queryParams: [],
            headers: [],
            cookies: [],
          },
        }),
      ),
    );
    await addMockRequestSchemaBodyExampleCommand(URI);
    const ep = parse(h.get());
    expect(ep.requestSchema.body?.description).toBeTruthy();
    expect(ep.requestSchema.body?.example).toBe('{}');
  });
});

describe('param field editors (◆ Type / ◆ Name)', () => {
  it('setMockParamTypeField picks a type hint for a param', async () => {
    const h = mountDoc(
      serializeEndpointToYaml(
        makeEndpoint({
          requestSchema: {
            pathParams: [{ id: 'p1', name: 'petId', typeHint: 'string' }],
            queryParams: [],
            headers: [],
            cookies: [],
          },
        }),
      ),
    );
    const typeLine = lineOf(h.get(), /^\s+typeHint:/);
    (window.showQuickPick as Mock).mockResolvedValueOnce('integer');
    await setMockParamTypeFieldCommand(URI, typeLine);
    expect(parse(h.get()).requestSchema.pathParams[0].typeHint).toBe('integer');
  });
});
