// The consumed import is the last line and the file ends without a trailing
// newline: the corner the import-strip rebuild has to handle.
export const Tail = ds.styles({ display: 'grid' }).asElement('div');
export const App = () => <Tail />;
import { animus } from '@animus-ui/system';