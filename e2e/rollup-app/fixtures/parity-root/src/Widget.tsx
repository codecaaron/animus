// Present in the fixture from the start. The parity check ADDS a sibling
// (`Alpha.tsx`) mid-watch: a fresh discovery walk sorts that sibling BEFORE
// this file, so the two paths only agree if the incremental pass orders its
// entries the way discovery does.
import { ds } from './ds';

export const Widget = ds
  .styles({
    padding: '8px',
    backgroundColor: '#8899aa',
  })
  .asElement('div');

export const WidgetApp = () => <Widget>parity</Widget>;
