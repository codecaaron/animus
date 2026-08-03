// ANI-008 witness (parent): a terminal that OWNS compounds. The extension
// chain in child.tsx inherits these; merged compound-config class names are
// renumbered against the extending component's class over the flattened
// (parent-first) order, so config `--compound-N` always names emitted rule N.
import { ds } from '../test-system';

export const Base = ds
  .styles({ display: 'inline-flex' })
  .variant({
    prop: 'tone',
    variants: { muted: { opacity: 0.5 }, bold: { opacity: 1 } },
  })
  .variant({
    prop: 'size',
    variants: { sm: { p: 4 }, lg: { p: 12 } },
  })
  .compound({ tone: 'bold', size: 'lg' }, { m: 10 })
  .compound({ tone: 'muted', size: 'sm' }, { m: 2 })
  .asElement('button');

export const ParentApp = () => <Base tone="bold" size="lg" />;
