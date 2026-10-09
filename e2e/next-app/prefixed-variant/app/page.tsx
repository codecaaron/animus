import { Card } from '../Card';

// Read at runtime, so the prop travels through its runtime slot.
const size = process.env.PREFIXED_SIZE ?? '20rem';

export default function Page() {
  return (
    <>
      <Card capSize="dialog" tint="ink">
        prefixed
      </Card>
      <Card capSize={size}>runtime</Card>
    </>
  );
}
