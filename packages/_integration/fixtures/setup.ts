export { tokens } from '../../extract/tests/test-system';

import { ds, tokens } from '../../extract/tests/test-system';

export const config = ds.toConfig();
export const theme = tokens.serialize();
