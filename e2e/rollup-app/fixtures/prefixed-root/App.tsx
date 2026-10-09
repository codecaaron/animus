import { Card } from './Card';

export const App = ({
  size,
  tone,
  look,
}: {
  size: string;
  tone: string;
  look: 'loud';
}) => (
  <>
    <Card capSize="dialog" tint="ink" look="loud">
      prefixed
    </Card>
    <Card capSize={size} tint={tone} look={look}>
      runtime
    </Card>
  </>
);
