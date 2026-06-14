import { describe, it, expect } from 'vitest';
import { Uri } from '../../test/mocks/vscode';
import { InFlightSendTracker } from './inFlightTracker';

function uri(path: string): Uri {
  return Uri.parse(`apicircle://w/requests/${path}.yaml`);
}

describe('InFlightSendTracker', () => {
  it('is empty by default', () => {
    const tracker = new InFlightSendTracker();
    expect(tracker.hasAny()).toBe(false);
    expect(tracker.isInFlight(uri('a'))).toBe(false);
    expect(tracker.get(uri('a'))).toBeUndefined();
    expect(tracker.snapshot().size).toBe(0);
  });

  it('records and clears entries keyed by uri.toString()', () => {
    const tracker = new InFlightSendTracker();
    const u = uri('a');
    tracker.start(u, 'run-1', 'GET a');
    expect(tracker.isInFlight(u)).toBe(true);
    expect(tracker.hasAny()).toBe(true);
    const entry = tracker.get(u);
    expect(entry?.runId).toBe('run-1');
    expect(entry?.requestName).toBe('GET a');
    expect(typeof entry?.startedAt).toBe('number');

    tracker.end(u);
    expect(tracker.isInFlight(u)).toBe(false);
    expect(tracker.hasAny()).toBe(false);
    expect(tracker.get(u)).toBeUndefined();
  });

  it('fires onDidChange on start and end', () => {
    const tracker = new InFlightSendTracker();
    let changes = 0;
    tracker.onDidChange(() => {
      changes += 1;
    });
    const u = uri('a');
    tracker.start(u, 'run-1', 'GET a');
    tracker.end(u);
    expect(changes).toBe(2);
  });

  it('does not fire onDidChange when end() targets a URI that is not tracked', () => {
    const tracker = new InFlightSendTracker();
    let changes = 0;
    tracker.onDidChange(() => {
      changes += 1;
    });
    tracker.end(uri('never-started'));
    expect(changes).toBe(0);
  });

  it('keeps separate entries for distinct URIs', () => {
    const tracker = new InFlightSendTracker();
    tracker.start(uri('a'), 'run-a', 'A');
    tracker.start(uri('b'), 'run-b', 'B');
    expect(tracker.snapshot().size).toBe(2);
    expect(tracker.get(uri('a'))?.runId).toBe('run-a');
    expect(tracker.get(uri('b'))?.runId).toBe('run-b');
  });

  it('snapshot() returns a copy that is not affected by later mutations', () => {
    const tracker = new InFlightSendTracker();
    tracker.start(uri('a'), 'run-a', 'A');
    const snap = tracker.snapshot();
    expect(snap.size).toBe(1);
    tracker.end(uri('a'));
    expect(snap.size).toBe(1);
    expect(tracker.snapshot().size).toBe(0);
  });

  it('dispose() clears entries', () => {
    const tracker = new InFlightSendTracker();
    tracker.start(uri('a'), 'run-a', 'A');
    tracker.dispose();
    expect(tracker.snapshot().size).toBe(0);
  });
});
