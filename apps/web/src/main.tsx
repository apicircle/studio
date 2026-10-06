import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, applyTheme, getStoredThemeId } from '@apicircle/ui-components';
import { parseDevWorkspaceAccess } from './devWorkspaceAccess';
import './styles/global.css';

// Theme is mirrored to localStorage for first-paint FOUC mitigation;
// the workspace store re-applies the workspace's themeId on hydrate.
applyTheme(getStoredThemeId());
// Font is workspace-bound (no localStorage shim) — system-mono renders
// during the brief hydrate window, then the workspace's local.ui.fontId
// applies via `applyFont` from the store's hydrate path.

// Dev server only: the Playwright web suite raises the workspace cap for the
// specs that drive the multi-workspace flows (see devWorkspaceAccess.ts).
// `vite build` replaces `import.meta.env.DEV` with `false` and drops the read,
// so the deployed web app and the packaged desktop app always render the
// free-tier default — `undefined` here is the same as passing nothing.
const workspaceAccess = import.meta.env.DEV
  ? parseDevWorkspaceAccess(window.__apicircleE2eWorkspaceAccess)
  : undefined;

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App workspaceAccess={workspaceAccess} />
  </StrictMode>,
);
