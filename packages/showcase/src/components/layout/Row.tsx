import { ds } from '../../ds';

export const Row = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
  })
  .system({ space: true, arrange: true, surface: true })
  .asElement('div');
