import { ds } from '../test-system';

export const AliasedCard = ds
  .styles({
    p: 8,
    _motionReduce: { display: 'none' },
  })
  .asElement('div');
export const App = () => <AliasedCard />;
