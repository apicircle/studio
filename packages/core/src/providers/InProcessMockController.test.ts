import { afterEach, describe, expect, it } from 'vitest';
import type { MockServer } from '@apicircle/shared';
import { InProcessMockController } from './InProcessMockController';

const T0 = '2026-04-27T00:00:00.000Z';

function manualMock(id: string): MockServer {
  return {
    id,
    name: `mock-${id}`,
    source: { kind: 'manual', endpoints: [] },
    endpoints: [
      {
        id: 'ep1',
        name: 'GET /health',
        method: 'GET',
        pathPattern: '/health',
        requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
        requestValidation: [],
        responseRules: [],
        defaultResponse: {
          status: 200,
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
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

const controller = new InProcessMockController();

afterEach(async () => {
  for (const r of await controller.list()) {
    await controller.stop(r.serverId);
  }
});

describe('InProcessMockController', () => {
  it('start + list + stop round-trips', async () => {
    const result = await controller.start(manualMock('a'));
    expect(result.port).toBeGreaterThan(0);
    const list = await controller.list();
    expect(list.find((r) => r.serverId === 'a')).toBeDefined();
    await controller.stop('a');
    const after = await controller.list();
    expect(after.find((r) => r.serverId === 'a')).toBeUndefined();
  });

  it('start errors when the mock is already running', async () => {
    await controller.start(manualMock('b'));
    await expect(controller.start(manualMock('b'))).rejects.toThrow(/already running/);
  });

  it('stop is a no-op for an unknown id', async () => {
    await controller.stop('unknown'); // should not throw
  });
});
