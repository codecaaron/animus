import { Card } from './Card';

export const App = ({ size }: { size: string }) => (
  <>
    <Card capSize="dialog" tint="ink">
      prefixed
    </Card>
    <Card capSize={size}>runtime</Card>
  </>
);
