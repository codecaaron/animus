// Duplicate identical compose() calls: v1 matches families by slot
// structure with find() and DOUBLE-REPLACES the first span (undefined
// mangling); v2 replaces each span once. Registered intentional-
// correctness divergence — ACTIVE as of this fixture.
import { compose } from '@animus-ui/system/compose';

const Root = ds.styles({ display: 'flex' }).asElement('div');
export const FamA = compose({ Root }, { name: 'A', shared: {} });
export const FamB = compose({ Root }, { name: 'B', shared: {} });
export const App = () => <FamA.Root />;
