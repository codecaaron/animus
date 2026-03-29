import { animus } from '@animus-ui/core';

export const Box = animus
  .styles({
    display: 'flex',
    position: 'relative',
  })
  .states({
    hidden: { opacity: 0, visibility: 'hidden' },
  })
  .system({
    space: true,
    layout: true,
    color: true,
  })
  .asElement('div');

export const Text = animus
  .styles({
    m: 0,
  })
  .system({
    typography: true,
    color: true,
    space: true,
  })
  .asElement('span');

// JSX usage — these are what the JSX scanner collects
export function Example() {
  return (
    <Box p={8} mt={{ _: 8, sm: 16 }} color="primary">
      <Text fontSize={16} color="text">
        Hello
      </Text>
      <Box p={16} display="flex" />
    </Box>
  );
}
