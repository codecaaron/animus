import { animus } from '@animus-ui/core';

export const PullUp = animus
  .styles({
    display: 'block',
    mt: -8,
  })
  .asElement('div');

export const Overlap = animus
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
