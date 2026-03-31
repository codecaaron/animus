import { ds } from '../ds';

export const Box = ds
  .styles({
    display: 'flex',
    position: 'relative',
  })
  .system({ space: true, layout: true })
  .asElement('div');
