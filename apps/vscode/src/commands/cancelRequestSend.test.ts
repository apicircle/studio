import type { vi } from 'vitest';
import { describe, it, expect, beforeEach } from 'vitest';
import { Uri, window } from '../../test/mocks/vscode';
import { AbortRegistry } from '../execute/abortRegistry';
import { InFlightSendTracker } from '../execute/inFlightTracker';
import { cancelOneSendCommand } from './cancelRequestSend';

function makeDeps() {
  return {
    abortRegistry: new AbortRegistry(),
    tracker: new InFlightSendTracker(),
  };
}

const requestUri = Uri.parse('apicircle://w/requests/foo.yaml');

describe('cancelOneSendCommand', () => {
  beforeEach(() => {
    (window.showInformationMessage as ReturnType<typeof vi.fn>).mockReset();
    window.activeTextEditor = undefined as unknown;
  });

  it('warns and exits when no URI is supplied and no active editor exists', async () => {
    await cancelOneSendCommand(makeDeps());
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'No request URI in focus to cancel.',
    );
  });

  it('warns when the URI has no in-flight send', async () => {
    const deps = makeDeps();
    await cancelOneSendCommand(deps, requestUri);
    expect(window.showInformationMessage).toHaveBeenCalledWith('No active send for this request.');
  });

  it('falls back to the active editor URI when no URI argument is supplied', async () => {
    const deps = makeDeps();
    window.activeTextEditor = { document: { uri: requestUri } } as unknown;
    deps.tracker.start(requestUri, 'run-1', 'GET foo');
    deps.abortRegistry.register('run-1');
    await cancelOneSendCommand(deps);
    expect(deps.abortRegistry.hasActive()).toBe(false);
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('cancels the matching run via the abort registry on a hit', async () => {
    const deps = makeDeps();
    const signal = deps.abortRegistry.register('run-1');
    deps.tracker.start(requestUri, 'run-1', 'GET foo');
    await cancelOneSendCommand(deps, requestUri);
    expect(signal.aborted).toBe(true);
    expect(deps.abortRegistry.hasActive()).toBe(false);
  });

  it('clears the tracker when the send already completed (registry race)', async () => {
    const deps = makeDeps();
    deps.tracker.start(requestUri, 'run-stale', 'GET foo');
    await cancelOneSendCommand(deps, requestUri);
    expect(deps.tracker.isInFlight(requestUri)).toBe(false);
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });
});
