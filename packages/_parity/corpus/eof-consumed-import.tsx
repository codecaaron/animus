// Review F7 witness: consumed import as the LAST line without a
// trailing newline — the strip loop's split/rebuild corner (v1
// transform_emitter 497-535).
export const Tail = ds.styles({ display: 'grid' }).asElement('div');
export const App = () => <Tail />;
import { animus } from '@animus-ui/system';