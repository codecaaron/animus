import { ds } from '../setup';

export const Box = ds
  .styles({
    display: 'flex',
    position: 'relative',
  })
  .system({
    space: true,
    layout: true,
    color: true,
  })
  .asElement('div');

export function Example() {
  return (
    <Box p={8} mt={{ _: 8, sm: 16 }} color="primary">
      <Box p={16} display="flex" />
    </Box>
  );
}
