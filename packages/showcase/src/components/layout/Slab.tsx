import { ds } from '../../ds';

export const Slab = ds
  .styles({
    width: '100%',
    maxWidth: '72rem',
    mx: 'auto',
  })
  .system({ space: true, arrange: true })
  .asElement('div');
