// Repeated `compose()` calls over the same slot binding: each call site must
// be replaced exactly once, never twice.
import { compose } from '@animus-ui/system/compose';

const Root = ds.styles({ display: 'flex' }).asElement('div');
export const FamA = compose({ Root }, { name: 'A', shared: {} });
export const FamB = compose({ Root }, { name: 'B', shared: {} });
export const App = () => <FamA.Root />;
