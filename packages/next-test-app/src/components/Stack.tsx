import { ds } from '../ds';

export const Stack = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  })
  .variant({
    prop: 'direction',
    defaultVariant: 'column',
    variants: {
      column: { flexDirection: 'column' },
      row: { flexDirection: 'row', alignItems: 'center' },
    },
  })
  .system({ space: true, layout: true })
  .asElement('div');
