import { ds } from './ds';

export const Button = ds
  .styles({
    padding: '8px',
    borderRadius: '4px',
    backgroundColor: 'blue.500',
  })
  .variant({
    prop: 'tone',
    variants: {
      quiet: { backgroundColor: 'gray.700' },
      loud: { backgroundColor: 'blue.700', fontWeight: 700 },
    },
  })
  .asElement('button');

export const App = () => <Button tone="loud">Ship it</Button>;
