import { Card } from '../Card';

// Read at runtime, so the prop travels through its runtime slot (a
// conditional of literals alone is proven, and compiles away).
const size = process.env.PREFIXED_SIZE ?? '20rem';
const tone = process.env.PREFIXED_TONE ?? 'ink';
const isLook = (value: string): value is 'loud' => value === 'loud';
const lookName = process.env.PREFIXED_QUIET
  ? ''
  : (process.env.PREFIXED_LOOK ?? 'loud');
const look = isLook(lookName) ? lookName : undefined;

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
