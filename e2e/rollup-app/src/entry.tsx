// Lane bundle entry: renders a KIT component beside the local Button —
// the kit-specifier redirect witness (the host must resolve
// '@animus-ui/test-ds' to the exact entry extraction analyzed, or Badge
// renders unstyled). The stylesheet import resolves through the host's
// in-process stub; the sheet itself arrives as the emitted animus.css
// asset, which the assert lane reads.
import '.animus/styles.css';
import { Badge } from '@animus-ui/test-ds';

import { App as ButtonApp, Button } from './Button';

export { Badge, Button };

export const App = () => (
  <div>
    <ButtonApp />
    <Badge color="danger">kit badge</Badge>
  </div>
);
