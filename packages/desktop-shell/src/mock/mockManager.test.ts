import { afterEach, describe, expect, it } from 'vitest';
import type { MockServer } from '@apicircle/shared';
import { MockManager } from './mockManager';

const T0 = '2026-04-27T00:00:00.000Z';

function mockServer(id: string): MockServer {
  return {
    id,
    name: `mock-${id}`,
    source: { kind: 'manual', endpoints: [] },
    endpoints: [
      {
        id: 'e1',
        name: 'GET /health',
        method: 'GET',
        pathPattern: '/health',
        requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
        requestValidation: [],
        responseRules: [],
        defaultResponse: {
          status: 200,
          headers: [],
          body: { type: 'json', content: '{"ok":true}' },
        },
      },
    ],
    defaultPort: 0,
    cors: { enabled: false, origins: [] },
    createdAt: T0,
    updatedAt: T0,
  };
}

const manager = new MockManager();

afterEach(async () => {
  await manager.stopAll();
});

describe('MockManager', () => {
  it('start binds a port and tracks runtime metadata', async () => {
    const runtime = await manager.start(mockServer('a'));
    expect(runtime.port).toBeGreaterThan(0);
    expect(runtime.pid).toBe(process.pid);
    expect(manager.getRuntime('a')?.port).toBe(runtime.port);
  });

  it('start errors when the same id is already running', async () => {
    await manager.start(mockServer('b'));
    await expect(manager.start(mockServer('b'))).rejects.toThrow(/already running/);
  });

  it('stop is a no-op for an unknown id', async () => {
    await manager.stop('not-running'); // should not throw
  });

  it('list returns currently running entries', async () => {
    await manager.start(mockServer('c'));
    const list = manager.list();
    expect(list.find((e) => e.serverId === 'c')).toBeDefined();
  });

  it('stopAll tears every running mock down', async () => {
    await manager.start(mockServer('d'));
    await manager.start(mockServer('e'));
    await manager.stopAll();
    expect(manager.list()).toEqual([]);
  });

  it('getRuntime returns null for an unknown id', () => {
    expect(manager.getRuntime('nope')).toBeNull();
  });
});
