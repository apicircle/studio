import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  App,
  applyFont,
  applyTheme,
  getStoredFontId,
  getStoredThemeId,
} from '@apicircle/ui-components';
import './styles/global.css';

applyTheme(getStoredThemeId());
applyFont(getStoredFontId());

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
