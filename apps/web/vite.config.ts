import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same-origin proxy for the e2e mock server. The browser strips the
// Cookie header on cross-origin fetches and won't accept Set-Cookie from
// a different origin either, so end-to-end cookie tests have to hit the
// app's own origin. The proxy forwards `/_mock/*` → `http://127.0.0.1:5176/*`
// so e2e specs can use `http://localhost:5174/_mock/anything/...` and the
// browser treats the request as same-origin (no Cookie strip, no CORS
// preflight). Cycle 12 of the editor/env/exec/history-100 plan.
const MOCK_PROXY_PORT = process.env.E2E_MOCK_PORT ?? '5176';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/_mock': {
        target: `http://127.0.0.1:${MOCK_PROXY_PORT}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/_mock/, ''),
      },
    },
  },
});
