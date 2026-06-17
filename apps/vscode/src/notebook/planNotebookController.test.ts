import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import * as vscodeMock from '../../test/mocks/vscode';
import { PlanNotebookController } from './planNotebookController';
import type { VsCodeBridge } from '../host/vscodeBridge';

async function settled(getStub: () => CellExecutionStub | undefined): Promise<void> {
  await vi.waitFor(
    () => {
      const stub = getStub();
      if (!stub) throw new Error('no execution stub yet');
      if (!stub.end.mock.calls.length) throw new Error('end() not called yet');
    },
    { timeout: 1000, interval: 5 },
  );
}

interface CellExecutionStub {
  start: Mock;
  end: Mock;
  replaceOutput: Mock;
  token: { onCancellationRequested: Mock };
}

let controllerStub: {
  id: string;
  viewType: string;
  label: string;
  supportedLanguages: string[];
  supportsExecutionOrder: boolean;
  description: string;
  executeHandler: ((cells: unknown[], notebook: unknown, ctrl: unknown) => void) | undefined;
  createNotebookCellExecution: (cell: unknown) => CellExecutionStub;
  dispose: Mock;
};

let executions: CellExecutionStub[];

function freshController() {
  executions = [];
  controllerStub = {
    id: '',
    viewType: '',
    label: '',
    supportedLanguages: [],
    supportsExecutionOrder: false,
    description: '',
    executeHandler: undefined,
    createNotebookCellExecution: vi.fn((_cell: unknown) => {
      const exec: CellExecutionStub = {
        start: vi.fn(),
        end: vi.fn(),
        replaceOutput: vi.fn(async () => undefined),
        token: { onCancellationRequested: vi.fn() },
      };
      executions.push(exec);
      return exec;
    }),
    dispose: vi.fn(),
  };
  // Patch the mock's `notebooks.createNotebookController` so it returns our spy.
  (
    vscodeMock.notebooks as unknown as {
      createNotebookController: () => typeof controllerStub;
    }
  ).createNotebookController = () => controllerStub;
}

function makeBridge(
  registered: Array<{
    workspace: { id: string };
    state: { synced: { collections: { requests: Record<string, unknown> } } };
  }>,
) {
  return {
    listWorkspaces: () =>
      registered.map((r) => ({
        workspace: r.workspace,
        read: vi.fn(async () => r.state),
        apply: vi.fn(),
        write: vi.fn(),
      })),
  } as unknown as VsCodeBridge;
}

function codeCell(value: string, metadata: Record<string, unknown> = {}) {
  return {
    kind: 2, // NotebookCellKind.Code
    document: { getText: () => value },
    metadata,
  };
}

function markdownCell() {
  return { kind: 1, document: { getText: () => 'just docs' }, metadata: {} };
}

describe('PlanNotebookController', () => {
  beforeEach(() => {
    freshController();
  });

  it('registers the controller with supportedLanguages, description, executionOrder', () => {
    new PlanNotebookController({ bridge: makeBridge([]) });
    expect(controllerStub.supportedLanguages).toContain('apicircle-plan-step');
    expect(controllerStub.supportedLanguages).toContain('markdown');
    expect(controllerStub.supportsExecutionOrder).toBe(true);
    expect(typeof controllerStub.executeHandler).toBe('function');
  });

  it('dispose() forwards to the underlying controller', () => {
    const c = new PlanNotebookController({ bridge: makeBridge([]) });
    c.dispose();
    expect(controllerStub.dispose).toHaveBeenCalledTimes(1);
  });

  it('emits per-cell error when notebook has no workspaceId metadata', async () => {
    new PlanNotebookController({ bridge: makeBridge([]) });
    const cells = [codeCell('# apicircle-plan-step: r1')];
    const notebook = { metadata: {} };
    controllerStub.executeHandler?.(cells, notebook, controllerStub);
    await settled(() => executions[0]);
    expect(executions).toHaveLength(1);
    expect(executions[0].end).toHaveBeenCalledWith(false, expect.any(Number));
    expect(executions[0].replaceOutput).toHaveBeenCalled();
  });

  it('emits per-cell error when the workspaceId is not registered', async () => {
    new PlanNotebookController({ bridge: makeBridge([]) });
    const cells = [codeCell('# apicircle-plan-step: r1')];
    const notebook = { metadata: { workspaceId: 'no-such' } };
    controllerStub.executeHandler?.(cells, notebook, controllerStub);
    await settled(() => executions[0]);
    expect(executions[0].end).toHaveBeenCalledWith(false, expect.any(Number));
  });

  it('skips markdown cells with a passing end()', async () => {
    new PlanNotebookController({
      bridge: makeBridge([
        {
          workspace: { id: 'ws-1' },
          state: { synced: { collections: { requests: {} } } },
        },
      ]),
    });
    const cells = [markdownCell()];
    const notebook = { metadata: { workspaceId: 'ws-1' } };
    controllerStub.executeHandler?.(cells, notebook, controllerStub);
    await settled(() => executions[0]);
    expect(executions[0].end).toHaveBeenCalledWith(true, expect.any(Number));
  });

  it('errors when a code cell has no plan-step directive', async () => {
    new PlanNotebookController({
      bridge: makeBridge([
        {
          workspace: { id: 'ws-1' },
          state: { synced: { collections: { requests: {} } } },
        },
      ]),
    });
    const cells = [codeCell('not a directive')];
    const notebook = { metadata: { workspaceId: 'ws-1' } };
    controllerStub.executeHandler?.(cells, notebook, controllerStub);
    await settled(() => executions[0]);
    expect(executions[0].end).toHaveBeenCalledWith(false, expect.any(Number));
  });

  it('emits skip info when directive declares the step disabled', async () => {
    new PlanNotebookController({
      bridge: makeBridge([
        {
          workspace: { id: 'ws-1' },
          state: { synced: { collections: { requests: {} } } },
        },
      ]),
    });
    const cells = [codeCell('# apicircle-plan-step: r1 # [disabled]')];
    const notebook = { metadata: { workspaceId: 'ws-1' } };
    controllerStub.executeHandler?.(cells, notebook, controllerStub);
    await settled(() => executions[0]);
    expect(executions[0].end).toHaveBeenCalledWith(true, expect.any(Number));
  });

  it('errors when directive references a request id not in the workspace', async () => {
    new PlanNotebookController({
      bridge: makeBridge([
        {
          workspace: { id: 'ws-1' },
          state: { synced: { collections: { requests: {} } } },
        },
      ]),
    });
    const cells = [codeCell('# apicircle-plan-step: r-missing')];
    const notebook = { metadata: { workspaceId: 'ws-1' } };
    controllerStub.executeHandler?.(cells, notebook, controllerStub);
    await settled(() => executions[0]);
    expect(executions[0].end).toHaveBeenCalledWith(false, expect.any(Number));
  });

  it('runs the request through the injected execute() and ends with passed=true on success without assertions', async () => {
    const request = {
      id: 'r1',
      name: 'r',
      folderId: null,
      method: 'GET',
      url: 'https://x',
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
    } as unknown;
    const execute = vi.fn(async () => ({
      status: 200,
      statusText: 'OK',
      durationMs: 4,
      body: { text: '{"ok":true}' },
    }));
    new PlanNotebookController({
      bridge: makeBridge([
        {
          workspace: { id: 'ws-1' },
          state: { synced: { collections: { requests: { r1: request } } } as never } as never,
        },
      ]),
      execute: execute as never,
    });
    const cells = [codeCell('# apicircle-plan-step: r1')];
    const notebook = { metadata: { workspaceId: 'ws-1' } };
    controllerStub.executeHandler?.(cells, notebook, controllerStub);
    await settled(() => executions[0]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(executions[0].end).toHaveBeenCalledWith(true, expect.any(Number));
  });

  it('reports execute() failures by ending with passed=false', async () => {
    const execute = vi.fn(async () => {
      throw new Error('network down');
    });
    const request = {
      id: 'r1',
      method: 'GET',
      url: 'https://x',
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
    } as unknown;
    new PlanNotebookController({
      bridge: makeBridge([
        {
          workspace: { id: 'ws-1' },
          state: { synced: { collections: { requests: { r1: request } } } as never } as never,
        },
      ]),
      execute: execute as never,
    });
    const cells = [codeCell('# apicircle-plan-step: r1')];
    const notebook = { metadata: { workspaceId: 'ws-1' } };
    controllerStub.executeHandler?.(cells, notebook, controllerStub);
    await settled(() => executions[0]);
    expect(executions[0].end).toHaveBeenCalledWith(false, expect.any(Number));
  });
});
