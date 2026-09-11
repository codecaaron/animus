import { ds } from '../test-system';

export const MotionCard = ds
  .styles({
    p: 8,
    _motionReduce: { transition: 'none' },
  })
  .asElement('div');
export const App = () => <MotionCard />;
