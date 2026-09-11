// `Header` is unbound: extraction must emit the compose-slot bail diagnostic
// and never resolve the same-named component defined in `other.tsx`.
import { compose } from '@animus-ui/system/compose';

import { Root } from './defs';

export const Fam = compose(
  // @ts-expect-error — Header is unbound; the resolver must fail closed.
  { Root, Header },
  { name: 'BailFam', shared: { density: true } }
);

export const App = () => (
  <Fam.Root density="loose">
    <Fam.Header />
  </Fam.Root>
);
