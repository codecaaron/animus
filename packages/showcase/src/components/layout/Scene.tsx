import { ds } from '../../ds';

export const Scene = ds
  .styles({
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  })
  .system({ space: true, surface: true, arrange: true })
  .asElement('section');
