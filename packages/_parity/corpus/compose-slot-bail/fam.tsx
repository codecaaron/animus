// The compose call names a Header slot with no local definition and no
// import path — extraction must emit the compose-slot bail diagnostic and
// drop the slot from composed CSS, NEVER guess a same-named component from
// another module (other.tsx exists precisely to be the wrong candidate).
import { compose } from '@animus-ui/system/compose';

import { Root } from './defs';

export const Fam = compose(
  // @ts-expect-error — Header is deliberately unbound; the scanner sees the
  // identifier, the resolver must fail closed.
  { Root, Header },
  { name: 'BailFam', shared: { density: true } }
);

export const App = () => (
  <Fam.Root density="loose">
    <Fam.Header />
  </Fam.Root>
);
