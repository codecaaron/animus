// ANI-005 witness: a composed shared axis whose Root declares a default.
// The emitter must produce the `--{prop}-default`-keyed inheritance rule
// (`.FamRoot--pace-default .FamStep` with the default option's styles) so an
// omitted Root prop propagates; the child's own defaulted axis still yields
// to root inheritance (no child-side default override rule).
import { compose } from '@animus-ui/system/compose';

import { ds } from './test-system';

export const FamRoot = ds
  .styles({ display: 'flex' })
  .variant({
    prop: 'pace',
    defaultVariant: 'steady',
    variants: { steady: { gap: 8 }, brisk: { gap: 2 } },
  })
  .asElement('div');

export const FamStep = ds
  .styles({ p: 4 })
  .variant({
    prop: 'pace',
    variants: { steady: { m: 4 }, brisk: { m: 1 } },
  })
  .asElement('span');

export const Fam = compose(
  { Root: FamRoot, Step: FamStep },
  { name: 'Paced', shared: { pace: true } }
);

export const App = () => (
  <>
    <Fam.Root>
      <Fam.Step />
    </Fam.Root>
    <Fam.Root pace="brisk">
      <Fam.Step />
    </Fam.Root>
  </>
);
