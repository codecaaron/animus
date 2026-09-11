// Each extension adds a compound after the inherited ones: the child's lands
// at flattened ordinal 2, the grandchild's at 3.
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
