// Review F5 witness: a file whose ONLY animus construct is a compose()
// call over IMPORTED slots has no surviving components of its own —
// v1 returns it UNCHANGED (lib.rs 950-958, before compose handling).
import { compose } from '@animus-ui/system/compose';

import { Root, Body } from './slots';

export const Fam = compose({ Root, Body }, { name: 'Card', shared: {} });
export const App = () => <Fam.Root />;
