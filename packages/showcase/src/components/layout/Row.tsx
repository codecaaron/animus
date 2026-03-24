import { ds } from '../../ds';

export const Row = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
  })
  .groups({ space: true, arrange: true, surface: true })
  .asElement('div');
