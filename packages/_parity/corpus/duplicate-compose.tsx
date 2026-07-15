// Duplicate identical compose() calls witnessed the retired live oracle's
// double-replacement bug. The committed v2 surface replaces each span once;
// no standing divergence license remains.
import { compose } from '@animus-ui/system/compose';

const Root = ds.styles({ display: 'flex' }).asElement('div');
export const FamA = compose({ Root }, { name: 'A', shared: {} });
export const FamB = compose({ Root }, { name: 'B', shared: {} });
export const App = () => <FamA.Root />;
