import { ds } from '../../../test-system';

export const Box = ds
  .styles({ display: 'flex', position: 'relative' })
  .states({ fit: { width: 1, height: 1 } })
  .system({ space: true, layout: true })
  .asElement('div');

export const FlexBox = ds
  .styles({ display: 'flex' })
  .system({ space: true, layout: true, flex: true })
  .asElement('div');
