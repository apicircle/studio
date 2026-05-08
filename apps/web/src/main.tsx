import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, applyTheme, getStoredThemeId } from '@apicircle/ui-components';
import './styles/global.css';

// Theme is mirrored to localStorage for first-paint FOUC mitigation;
// the workspace store re-applies the workspace's themeId on hydrate.
applyTheme(getStoredThemeId());
// Font is workspace-bound (no localStorage shim) — system-mono renders
// during the brief hydrate window, then the workspace's local.ui.fontId
// applies via `applyFont` from the store's hydrate path.

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
