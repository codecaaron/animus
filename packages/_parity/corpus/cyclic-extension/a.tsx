import { ds } from '../test-system';
import { B } from './b';

export const A = B.extend().styles({ p: 4 }).asElement('div');
