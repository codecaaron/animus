import { Card } from '../components/Card';
import { Button } from '@/components/Button';

export default function Home() {
  return (
    <main>
      <Card>
        <Button color="lightpink" bg="red" my={[4, 8]}>
          Click me
        </Button>
        <Button p={{ _: 4, sm: 16 }} size="small">
          Click me
        </Button>
        <Button disabled>Click me</Button>{' '}
      </Card>
    </main>
  );
}
