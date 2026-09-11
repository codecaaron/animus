// The Root declares a default on the shared axis, so an omitted Root prop must
// still reach the slots through a default-keyed inheritance rule.
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
