import { compose } from '@animus-ui/system';

import { ds } from '../test-system';

const PanelRoot = ds.styles({ display: 'flex', gap: 8 }).asElement('div');
const PanelBody = ds.styles({ display: 'block', p: 8 }).asElement('div');

export const Panel = compose(
  { Root: PanelRoot, Body: PanelBody },
  { shared: {} }
);

export const App = () => (
  <Panel.Root>
    <Panel.Body p={4} />
  </Panel.Root>
);
