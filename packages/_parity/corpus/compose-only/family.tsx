import { compose } from '@animus-ui/system/compose';

import { Root, Body } from './slots';

export const Fam = compose({ Root, Body }, { name: 'Card', shared: {} });
export const App = () => <Fam.Root />;
