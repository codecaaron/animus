import { Card } from './Card';

// Wide parameter types, so each runtime value travels through its runtime
// config: a literal-union annotation would prove the value and select its
// static class instead.
export const App = ({
  size,
  tone,
  look,
}: {
  size: string;
  tone: string;
  look: string;
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
