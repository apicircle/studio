import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { commands, window } from '../../test/mocks/vscode';
import { openPlanAsNotebookCommand } from './openPlanAsNotebook';
import type { VsCodeBridge } from '../host/vscodeBridge';

function makeBridge(plans: Record<string, unknown>, apicircleDir: string) {
  return {
    activeWorkspace: () =>
      ({
        workspace: { id: 'ws-1', apicircleDir },
        read: vi.fn(async () => ({
          synced: { executionPlans: plans } as never,
          local: {} as never,
        })),
        apply: vi.fn(),
        write: vi.fn(),
      }) as unknown as ReturnType<VsCodeBridge['activeWorkspace']>,
  } as unknown as VsCodeBridge;
}

const emptyBridge = {
  activeWorkspace: () => null,
} as unknown as VsCodeBridge;

let tmp: string;

describe('openPlanAsNotebookCommand', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-notebook-'));
    fs.mkdirSync(path.join(tmp, '.apicircle'), { recursive: true });
    (window.showWarningMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    (window.showErrorMessage as Mock).mockReset();
    (window.showQuickPick as Mock).mockReset();
    (commands.executeCommand as Mock).mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('warns when no active workspace', async () => {
    await openPlanAsNotebookCommand({ bridge: emptyBridge });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No active APICircle workspace'),
    );
  });

  it('reports an empty list when the workspace has no execution plans', async () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    const bridge = makeBridge({}, apicircleDir);
    await openPlanAsNotebookCommand({ bridge });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('no execution plans'),
    );
  });

  it('writes the plan as a json notebook next to .apicircle/ and opens it', async () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    const bridge = makeBridge(
      {
        'plan-1': { id: 'plan-1', name: 'Deploy flow', steps: [{ id: 's' }] },
      },
      apicircleDir,
    );
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'plan-1' });
    await openPlanAsNotebookCommand({ bridge });
    const expectedPath = path.join(tmp, 'deploy-flow.apicircle-plan.json');
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      expect.objectContaining({ scheme: 'file' }),
      'apicircle-plan',
    );
  });

  it('skips the picker when planId arg directly resolves a plan', async () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    const bridge = makeBridge(
      {
        'plan-2': { id: 'plan-2', name: 'Smoke test', steps: [] },
      },
      apicircleDir,
    );
    await openPlanAsNotebookCommand({ bridge }, { planId: 'plan-2' });
    expect(window.showQuickPick).not.toHaveBeenCalled();
    expect(commands.executeCommand).toHaveBeenCalled();
  });

  it('falls back to the picker when planId arg does not resolve', async () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    const bridge = makeBridge(
      {
        'plan-3': { id: 'plan-3', name: 'Real', steps: [] },
      },
      apicircleDir,
    );
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await openPlanAsNotebookCommand({ bridge }, { planId: 'no-such-plan' });
    expect(window.showQuickPick).toHaveBeenCalled();
  });

  it('opens an existing notebook file without overwriting it', async () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    const filePath = path.join(tmp, 'reuse-me.apicircle-plan.json');
    fs.writeFileSync(filePath, '{"keep":"this"}\n');
    const bridge = makeBridge(
      {
        'plan-4': { id: 'plan-4', name: 'Reuse me', steps: [] },
      },
      apicircleDir,
    );
    await openPlanAsNotebookCommand({ bridge }, { planId: 'plan-4' });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"keep":"this"}\n');
    expect(commands.executeCommand).toHaveBeenCalled();
  });

  it('uses "plan" as the slug fallback for an unnameable plan', async () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    const bridge = makeBridge(
      {
        'plan-5': { id: 'plan-5', name: '!!!', steps: [] },
      },
      apicircleDir,
    );
    await openPlanAsNotebookCommand({ bridge }, { planId: 'plan-5' });
    const expectedPath = path.join(tmp, 'plan.apicircle-plan.json');
    expect(fs.existsSync(expectedPath)).toBe(true);
  });
});
