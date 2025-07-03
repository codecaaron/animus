import { Button } from './Button';
import { Card } from './Card';
import { DangerButton, PrimaryButton } from './ExtendedButton';

function App() {
  return (
    <Card>
      <Button color="lightpink" bg="red" my={[4, 8]}>
        Click me
      </Button>
      <Button p={{ _: 4, sm: 16 }} size="small">
        Click me
      </Button>
      <Button disabled>Click me</Button>
      <PrimaryButton>Primary Button</PrimaryButton>
      <DangerButton>Danger Button</DangerButton>
    </Card>
  );
}

export default App;
