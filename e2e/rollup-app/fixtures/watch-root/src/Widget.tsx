// The watch scenario's edit target: assert-watch.mjs rewrites this file's
// backgroundColor (republication witness) and temporarily adds a `glow`
// usage (error-diagnostic keep-last-good witness). Keep the shape in sync
// with scripts/assert-watch.mjs `widgetSource`.
import { ds } from './ds';

export const Widget = ds
  .styles({
    padding: '8px',
    backgroundColor: '#8899aa',
  })
  .asElement('div');

export const App = () => <Widget>watch me</Widget>;
