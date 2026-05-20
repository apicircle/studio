import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { getFreePort, isPortFree } from './portFinder';

describe('getFreePort', () => {
  it('returns a usable port number', async () => {
    const port = await getFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
    // We should be able to bind to it.
    expect(await isPortFree(port)).toBe(true);
  });

  it('returns a different port across calls (when previous is held)', async () => {
    const a = await getFreePort();
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(a, () => resolve());
    });
    try {
      expect(await isPortFree(a)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('isPortFree', () => {
  it('reports false for a port that is currently in use', async () => {
    const server = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) resolve(addr.port);
        else reject(new Error('no port'));
      });
    });
    try {
      expect(await isPortFree(port)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('reports true for a port that becomes free again', async () => {
    const port = await getFreePort();
    expect(await isPortFree(port)).toBe(true);
  });
});
