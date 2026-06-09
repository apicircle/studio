import { describe, it, expect } from 'vitest';
import {
  PlanNotebookSerializer,
  parseStepCellDirective,
  buildPayloadFromPlan,
  PLAN_NOTEBOOK_SCHEMA_VERSION,
} from './planNotebookSerializer';
import * as vscode from '../../test/mocks/vscode';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

function makeSerializer(
  requestLookup: Record<string, { name: string; method: string; url: string }> = {},
): PlanNotebookSerializer {
  return new PlanNotebookSerializer((id) => requestLookup[id] ?? null);
}

describe('parseStepCellDirective', () => {
  it('extracts requestId from a bare directive', () => {
    expect(parseStepCellDirective('# apicircle-plan-step: req-1')).toEqual({
      requestId: 'req-1',
      enabled: undefined,
      linkedWorkspaceId: undefined,
    });
  });

  it('parses linked workspace flag', () => {
    expect(parseStepCellDirective('# apicircle-plan-step: req-1 # [linked=ws-xyz]')).toEqual({
      requestId: 'req-1',
      linkedWorkspaceId: 'ws-xyz',
      enabled: undefined,
    });
  });

  it('parses disabled flag', () => {
    expect(parseStepCellDirective('# apicircle-plan-step: req-1 # [disabled]')).toEqual({
      requestId: 'req-1',
      enabled: false,
      linkedWorkspaceId: undefined,
    });
  });

  it('parses both flags together', () => {
    expect(
      parseStepCellDirective('# apicircle-plan-step: req-1 # [disabled, linked=ws-1]'),
    ).toEqual({
      requestId: 'req-1',
      enabled: false,
      linkedWorkspaceId: 'ws-1',
    });
  });

  it('returns null when the line is missing the directive', () => {
    expect(parseStepCellDirective('GET /foo')).toBeNull();
    expect(parseStepCellDirective('')).toBeNull();
  });

  it('tolerates extra whitespace', () => {
    expect(parseStepCellDirective('#   apicircle-plan-step:   req-1')).toEqual({
      requestId: 'req-1',
      enabled: undefined,
      linkedWorkspaceId: undefined,
    });
  });
});

describe('buildPayloadFromPlan', () => {
  it('returns a payload with the canonical shape', () => {
    const payload = buildPayloadFromPlan('ws-1', {
      id: 'plan-1',
      steps: [
        { requestId: 'req-1' },
        { requestId: 'req-2', enabled: false },
        { requestId: 'req-3', linkedWorkspaceId: 'ws-other' },
      ],
      envPriorityOrder: [],
    });
    expect(payload).toEqual({
      schemaVersion: PLAN_NOTEBOOK_SCHEMA_VERSION,
      planId: 'plan-1',
      workspaceId: 'ws-1',
      envPriorityOrder: [],
      steps: [
        { requestId: 'req-1' },
        { requestId: 'req-2', enabled: false },
        { requestId: 'req-3', linkedWorkspaceId: 'ws-other' },
      ],
    });
  });

  it('omits variables + stopOnAssertionFailure when not set', () => {
    const payload = buildPayloadFromPlan('ws-1', {
      id: 'p',
      steps: [],
      envPriorityOrder: [],
    });
    expect(payload.variables).toBeUndefined();
    expect(payload.stopOnAssertionFailure).toBeUndefined();
  });

  it('preserves variables + stopOnAssertionFailure', () => {
    const payload = buildPayloadFromPlan('ws-1', {
      id: 'p',
      steps: [],
      envPriorityOrder: [],
      variables: [{ key: 'token', value: 'abc' }],
      stopOnAssertionFailure: true,
    });
    expect(payload.variables).toEqual([{ key: 'token', value: 'abc' }]);
    expect(payload.stopOnAssertionFailure).toBe(true);
  });
});

describe('PlanNotebookSerializer — round-trip', () => {
  const sampleRequests = {
    'req-1': { name: 'Login', method: 'POST', url: 'https://api/login' },
    'req-2': { name: 'Profile', method: 'GET', url: 'https://api/me' },
  };

  function payloadToBytes(payload: unknown): Uint8Array {
    return ENCODER.encode(JSON.stringify(payload, null, 2) + '\n');
  }

  it('deserialises an empty file into an empty notebook', () => {
    const ser = makeSerializer();
    const data = ser.deserializeNotebook(ENCODER.encode(''));
    expect(data.cells).toHaveLength(0);
  });

  it('deserialises a single-step payload + renders the cell source', () => {
    const ser = makeSerializer(sampleRequests);
    const data = ser.deserializeNotebook(
      payloadToBytes({
        schemaVersion: 1,
        planId: 'plan-1',
        workspaceId: 'ws-1',
        steps: [{ requestId: 'req-1' }],
        envPriorityOrder: [],
      }),
    );
    expect(data.cells).toHaveLength(1);
    expect(data.cells[0].value).toContain('# apicircle-plan-step: req-1');
    expect(data.cells[0].value).toContain('POST https://api/login');
    expect(data.cells[0].value).toContain('# Login');
    expect(data.cells[0].languageId).toBe('apicircle-plan-step');
  });

  it('surfaces a not-found note when the requestId is missing', () => {
    const ser = makeSerializer({}); // no lookups
    const data = ser.deserializeNotebook(
      payloadToBytes({
        schemaVersion: 1,
        planId: 'plan-1',
        workspaceId: 'ws-1',
        steps: [{ requestId: 'orphan' }],
        envPriorityOrder: [],
      }),
    );
    expect(data.cells[0].value).toContain('(request not found in workspace');
  });

  it('round-trips a multi-step payload — bytes preserved', () => {
    const ser = makeSerializer(sampleRequests);
    const original = {
      schemaVersion: 1,
      planId: 'plan-1',
      workspaceId: 'ws-1',
      steps: [{ requestId: 'req-1' }, { requestId: 'req-2', enabled: false }],
      envPriorityOrder: [],
    };
    const data = ser.deserializeNotebook(payloadToBytes(original));
    const reSerialised = ser.serializeNotebook(data);
    const parsed = JSON.parse(DECODER.decode(reSerialised));
    expect(parsed).toEqual(original);
  });

  it('preserves notebook-level metadata (variables, stopOnAssertionFailure)', () => {
    const ser = makeSerializer(sampleRequests);
    const original = {
      schemaVersion: 1,
      planId: 'plan-1',
      workspaceId: 'ws-1',
      steps: [{ requestId: 'req-1' }],
      envPriorityOrder: [],
      variables: [{ key: 'token', value: 'abc' }],
      stopOnAssertionFailure: true,
    };
    const data = ser.deserializeNotebook(payloadToBytes(original));
    const reSerialised = ser.serializeNotebook(data);
    const parsed = JSON.parse(DECODER.decode(reSerialised));
    expect(parsed).toEqual(original);
  });

  it('preserves linkedWorkspaceId on round-trip', () => {
    const ser = makeSerializer(sampleRequests);
    const original = {
      schemaVersion: 1,
      planId: 'plan-1',
      workspaceId: 'ws-1',
      steps: [{ requestId: 'req-1', linkedWorkspaceId: 'ws-other' }],
      envPriorityOrder: [],
    };
    const data = ser.deserializeNotebook(payloadToBytes(original));
    const reSerialised = ser.serializeNotebook(data);
    const parsed = JSON.parse(DECODER.decode(reSerialised));
    expect(parsed.steps[0].linkedWorkspaceId).toBe('ws-other');
  });

  it('emits a parse-error cell instead of throwing on malformed JSON', () => {
    const ser = makeSerializer();
    const data = ser.deserializeNotebook(ENCODER.encode('{ not json'));
    expect(data.cells).toHaveLength(1);
    expect(data.cells[0].kind).toBe(vscode.NotebookCellKind.Markup);
    expect(data.cells[0].value).toContain('Plan Notebook parse error');
  });

  it('user-edited directive line overrides cell metadata on save', () => {
    const ser = makeSerializer(sampleRequests);
    const data = ser.deserializeNotebook(
      payloadToBytes({
        schemaVersion: 1,
        planId: 'plan-1',
        workspaceId: 'ws-1',
        steps: [{ requestId: 'req-1' }],
        envPriorityOrder: [],
      }),
    );
    // Simulate a user hand-editing the directive to point at req-2.
    data.cells[0].value = '# apicircle-plan-step: req-2\nPOST /override';
    const reSerialised = ser.serializeNotebook(data);
    const parsed = JSON.parse(DECODER.decode(reSerialised));
    expect(parsed.steps[0].requestId).toBe('req-2');
  });

  it('skips cells without a discoverable requestId on save', () => {
    const ser = makeSerializer(sampleRequests);
    const data = ser.deserializeNotebook(
      payloadToBytes({
        schemaVersion: 1,
        planId: 'plan-1',
        workspaceId: 'ws-1',
        steps: [{ requestId: 'req-1' }],
        envPriorityOrder: [],
      }),
    );
    // User wiped the directive line.
    data.cells[0].value = '# just a note';
    data.cells[0].metadata = undefined;
    const reSerialised = ser.serializeNotebook(data);
    const parsed = JSON.parse(DECODER.decode(reSerialised));
    expect(parsed.steps).toEqual([]);
  });
});
