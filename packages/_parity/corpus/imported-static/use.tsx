import { shared, half } from './tokens';

export const Card = ds.styles(shared).asElement('div');
export const Slim = ds.styles({ m: half }).asElement('span');
export const App = () => (
  <div>
    <Card />
    <Slim />
  </div>
);
