import { ds } from '../setup';

export const Card = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
  })
  .props({
    sizing: {
      property: 'flexBasis',
      transform: 'size',
    },
  })
  .asElement('div');

export function CardExample() {
  return <Card sizing={100} />;
}
