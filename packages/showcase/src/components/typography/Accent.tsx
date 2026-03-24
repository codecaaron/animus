import { ds } from '../../ds';

export const Accent = ds
  .styles({
    color: 'primary',
    fontStyle: 'italic',
  })
  .asElement('em');
