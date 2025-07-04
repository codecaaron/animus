import { Card } from './Card';

const NotUsed = () => {
  return (
    <Card raised display={['none', 'flex', 'block', 'inline-block']}>
      <div>Not used</div>;
    </Card>
  );
};

export { NotUsed };
