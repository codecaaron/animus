// `.animus/styles.css` is a virtual specifier the host resolves; the kit
// Badge must keep rendering to hold the cross-package specifier redirect.
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
