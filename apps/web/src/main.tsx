import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, applyTheme, getStoredThemeId } from '@apicircle-v2/ui-components';
import './styles/global.css';

applyTheme(getStoredThemeId());

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
