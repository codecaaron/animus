import { animus } from '@animus-ui/core';

export const Anchor = animus
  .styles({
    display: 'inline-block',
    cursor: 'pointer',
    color: 'primary',
  })
  .variant({
    variants: {
      ui: { fontWeight: 700 },
      text: { fontWeight: 400 },
    },
  })
  .states({
    active: { fontWeight: 600 },
  })
  .system({
    space: true,
    typography: true,
  })
  .asElement('a');
