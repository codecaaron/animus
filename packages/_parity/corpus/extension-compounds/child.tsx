// ANI-008 witness (child + grandchild): extensions that ADD compounds after
// inheriting the parent's two. Child's new compound is emitted at flattened
// ordinal 2; the grandchild inherits three and adds one at ordinal 3 —
// pinning the renumbering at two extension depths.
import { Base } from './parent';

export const IconButton = Base.extend()
  .styles({ borderRadius: 4 })
  .compound({ tone: 'bold', size: 'sm' }, { p: 6 })
  .asElement('button');

export const FabButton = IconButton.extend()
  .styles({ position: 'fixed' })
  .compound({ tone: 'muted', size: 'lg' }, { p: 14 })
  .asElement('button');

export const ChildApp = () => (
  <>
    <IconButton tone="bold" size="sm" />
    <FabButton tone="muted" size="lg" />
  </>
);
