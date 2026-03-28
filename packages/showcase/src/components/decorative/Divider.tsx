import { ds } from '../../ds';

export const Divider = ds
  .styles({
    width: '1px',
    bg: 'border',
    border: 'none',
    mx: 'auto',
  })
  .groups({ space: true, arrange: true })
  .asElement('hr');
