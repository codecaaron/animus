import { StrictMode } from 'react';

import { createRoot } from 'react-dom/client';
import 'virtual:animus/styles.css';

import App from './App';
import { MODE_NAMES } from './components/docs/ColorPalette';
import { migrateShowcaseLegacyKey } from './lib/appearance';

// The generated bootstrap knows only the contract's legacy key, so without
// this a returning visitor's mode is lost; running post-paint flashes once.
const migratedMode = migrateShowcaseLegacyKey(MODE_NAMES);
if (migratedMode) {
  document.documentElement.setAttribute('data-color-mode', migratedMode);
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
