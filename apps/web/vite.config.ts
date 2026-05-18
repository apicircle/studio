import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Serve `monaco-editor`'s AMD bundle from its npm package under
// `/monaco-vendor/vs/*` so `@monaco-editor/react` can load it from the
// app origin instead of jsdelivr. Pinning to local removes the CDN
// dependency (the original cause of Playwright "Loading editor…" hangs)
// and matches the desktop runtime which has no internet at all.
function monacoVendor(): Plugin {
  let monacoRoot: string | null = null;
  return {
    name: 'apicircle-monaco-vendor',
    configResolved() {
      const here = dirname(fileURLToPath(import.meta.url));
      const require = createRequire(`${here}/_resolve.js`);
      const pkgPath = require.resolve('monaco-editor/package.json');
      monacoRoot = resolvePath(dirname(pkgPath), 'min', 'vs');
    },
    configureServer(server) {
      server.middlewares.use('/monaco-vendor/vs', async (req, res, next) => {
        if (!monacoRoot) return next();
        const url = (req.url ?? '/').split('?')[0];
        const filePath = resolvePath(monacoRoot, '.' + url);
        if (!filePath.startsWith(monacoRoot)) return next();
        try {
          const s = await stat(filePath);
          if (!s.isFile()) return next();
          const ext = filePath.slice(filePath.lastIndexOf('.'));
          const types: Record<string, string> = {
            '.js': 'application/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.ttf': 'font/ttf',
            '.svg': 'image/svg+xml',
            '.html': 'text/html; charset=utf-8',
            '.wasm': 'application/wasm',
          };
          res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'public, max-age=600');
          createReadStream(filePath).pipe(res);
        } catch {
          next();
        }
      });
    },
  };
}

// Same-origin proxy for the e2e mock server. The browser strips the
// Cookie header on cross-origin fetches and won't accept Set-Cookie from
// a different origin either, so end-to-end cookie tests have to hit the
// app's own origin. The proxy forwards `/_mock/*` → `http://127.0.0.1:5176/*`
// so e2e specs can use `http://localhost:5174/_mock/anything/...` and the
// browser treats the request as same-origin (no Cookie strip, no CORS
// preflight). Cycle 12 of the editor/env/exec/history-100 plan.
const MOCK_PROXY_PORT = process.env.E2E_MOCK_PORT ?? '5176';

export default defineConfig({
  plugins: [react(), monacoVendor()],
  server: {
    port: 5174,
    proxy: {
      '/_mock': {
        target: `http://127.0.0.1:${MOCK_PROXY_PORT}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/_mock/, ''),
      },
      // GitHub's `github.com/login/*` endpoints don't return CORS headers,
      // so a browser can't talk to them directly. Forward through the dev
      // server (which is server-side and exempt from CORS) for the device-
      // flow start + token-poll endpoints.
      '/_gh-oauth': {
        target: 'https://github.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/_gh-oauth/, ''),
      },
    },
  },
});
