// The parity check adds an `Alpha.tsx` sibling mid-watch, which sorts before
// this file: the incremental pass must order entries the way discovery does.
import { ds } from './ds';

export const Widget = ds
  .styles({
    padding: '8px',
    backgroundColor: '#8899aa',
  })
  .asElement('div');

export const WidgetApp = () => <Widget>parity</Widget>;
