import { StrictMode } from 'react';

import { createRoot } from 'react-dom/client';
import 'virtual:animus/styles.css';

import App from './App';
import { MODE_NAMES } from './components/docs/ColorPalette';
import { migrateShowcaseLegacyKey } from './lib/appearance';

// One-shot migration of the showcase's pre-record key (`animus-color-mode`).
// The generated bootstrap only knows the CONTRACT's legacy key, so without this
// a returning visitor's mode would be dropped on the floor. It runs here, after
// the stylesheet has already painted the OS-resolved mode: this one visit
// flash-corrects, and every later load restores pre-paint from the record.
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
