import { Card } from '../Card';

// Read at runtime, so the prop travels through its runtime slot.
const size = process.env.PREFIXED_SIZE ?? '20rem';
const tone = process.env.PREFIXED_TONE ?? 'ink';
const look = process.env.PREFIXED_QUIET ? undefined : 'loud';

export default function Page() {
  return (
    <>
      <Card capSize="dialog" tint="ink" look="loud">
        prefixed
      </Card>
      <Card capSize={size} tint={tone} look={look}>
        runtime
      </Card>
    </>
  );
}
