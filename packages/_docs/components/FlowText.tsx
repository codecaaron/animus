import { animus } from '@animus-ui/core';

export const FlowText = animus
  .styles({
    fontWeight: 700,
    fontSize: 18,
    bg: 'transparent',
    letterSpacing: '1px',
    gradient: 'flowX',
    backgroundSize: '300px 100px',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    textShadow: 'link-raised',
  })
  .groups({ typography: true, layout: true, space: true })
  .asComponent('div');
