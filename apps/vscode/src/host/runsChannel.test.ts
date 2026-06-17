import { describe, expect, it, beforeEach } from 'vitest';
import type { vi } from 'vitest';
import { RunsChannel } from './runsChannel';

// Vitest aliases `vscode` to test/mocks/vscode.ts — the mock returns a stub
// OutputChannel with appendLine + dispose tracked via vi.fn().

describe('RunsChannel', () => {
  let lines: string[];
  beforeEach(() => {
    lines = [];
  });

  it('is lazy — does not create the channel until first log()', () => {
    const ch = new RunsChannel({ sink: (line) => lines.push(line) });
    expect(ch.isCreated()).toBe(false);
    ch.log('mock', 'hello');
    // With a sink, isCreated stays false because we never touched the
    // underlying vscode.OutputChannel.
    expect(ch.isCreated()).toBe(false);
    expect(lines.length).toBe(1);
  });

  it('formats lines as "[category] <iso> <message>"', () => {
    const ch = new RunsChannel({ sink: (line) => lines.push(line) });
    ch.log('vault', 'unlocked');
    expect(lines[0]).toMatch(/^\[vault\] \d{4}-\d{2}-\d{2}T.*Z unlocked$/);
  });

  it('forCategory returns a logger bound to that category', () => {
    const ch = new RunsChannel({ sink: (line) => lines.push(line) });
    const planLog = ch.forCategory('plan');
    planLog('step 1 done');
    expect(lines[0]).toMatch(/^\[plan\] /);
    expect(lines[0]).toContain('step 1 done');
  });

  it('reveal() creates the channel if not yet created', async () => {
    const vscodeMock = await import('../../test/mocks/vscode');
    (vscodeMock.window.createOutputChannel as ReturnType<typeof vi.fn>).mockClear();
    const ch = new RunsChannel();
    expect(ch.isCreated()).toBe(false);
    ch.reveal();
    expect(ch.isCreated()).toBe(true);
    expect(vscodeMock.window.createOutputChannel).toHaveBeenCalledWith('APICircle Runs');
  });

  it('dispose() resets isCreated', async () => {
    const ch = new RunsChannel();
    ch.log('misc', 'x');
    expect(ch.isCreated()).toBe(true);
    ch.dispose();
    expect(ch.isCreated()).toBe(false);
  });

  it('honours a custom name', async () => {
    const vscodeMock = await import('../../test/mocks/vscode');
    (vscodeMock.window.createOutputChannel as ReturnType<typeof vi.fn>).mockClear();
    const ch = new RunsChannel({ name: 'APICircle Runs (Test)' });
    ch.log('misc', 'x');
    expect(vscodeMock.window.createOutputChannel).toHaveBeenCalledWith('APICircle Runs (Test)');
  });
});
