import { ds } from '../test-system';

export const PullUp = ds
  .styles({
    display: 'block',
    mt: -8,
  })
  .asElement('div');

export const Overlap = ds
  .styles({
    position: 'relative',
    top: -16,
    ml: -4,
  })
  .system({ space: true })
  .asElement('div');

export function Example() {
  return (
    <div>
      <PullUp />
      <Overlap m={-8} />
    </div>
  );
}
