// child.tsx extends these compounds: merged compound class names renumber over
// the flattened parent-first order, so `--compound-N` names emitted rule N.
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
