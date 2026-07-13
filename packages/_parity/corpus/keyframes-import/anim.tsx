import { motion } from './system';

export const Pulse = ds
  .styles({ animationName: motion.ember, display: 'flex' })
  .asElement('div');
export const App = () => <Pulse />;
