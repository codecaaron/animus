// Built-in `_osDark` and user-band `_motionReduce` in one style object: they
// are authored user-first because emission must sort by registry order.
import { ds } from '../test-system';

export const OrderProbe = ds
  .styles({
    p: 8,
    _motionReduce: { transition: 'none' },
    _osDark: { colorScheme: 'dark' },
  })
  .asElement('div');
export const App = () => <OrderProbe />;
