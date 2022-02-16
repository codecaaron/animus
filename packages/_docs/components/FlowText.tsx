import { animus } from '@animus-ui/core';

export const FlowText = animus
  .styles({
    fontSize: 18,
    fontWeight: 500,
    letterSpacing: '1px',
    bg: 'transparent',
    gradient: 'flowX',
    backgroundSize: '300px 100px',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    textShadow: 'link-raised',
    position: 'relative',
    top: '2px',
  })
  .states({
    flat: {
      letterSpacing: '0px',
      textShadow: 'flush',
    },
    bare: {
      fontSize: 'inherit',
      textShadow: 'none',
      display: 'inline-block',
    },
  })
  .groups({ typography: true, layout: true, space: true })
  .asComponent('div');
