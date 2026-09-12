// The watch check rewrites this file mid-run: keep its shape in sync with
// `widgetSource` in scripts/assert-watch.mjs.
import { ds } from './ds';

export const Widget = ds
  .styles({
    padding: '8px',
    backgroundColor: '#8899aa',
  })
  .asElement('div');

export const App = () => <Widget>watch me</Widget>;
