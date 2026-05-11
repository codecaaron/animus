import { ds } from '../../ds';

export const Stack = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
  })
  .system({ space: true, arrange: true, surface: true })
  .asElement('div');
