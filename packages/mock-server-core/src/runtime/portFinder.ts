// Find a free TCP port. Listens on port 0 (OS assigns), captures the
// chosen port, then releases the listener immediately. Standard pattern;
// the caveat is the tiny race where a different process grabs the port
// between our close and the caller's bind — but for desktop / CLI mock
// servers this race is negligible.

import { createServer } from 'node:net';

export async function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (typeof address === 'object' && address !== null) {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not determine free port')));
      }
    });
  });
}

export async function isPortFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}
