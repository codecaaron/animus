import { animus } from '@animus-ui/core';

export const FlowText = animus
  .styles({
    border: 'none',
    boxShadow: 'none',
    fontWeight: 700,
    fontSize: 18,
    p: 0,
    bg: 'transparent',
    textAlign: 'left',
    fontFamily: 'mono',
    letterSpacing: '1px',
    backgroundImage: ({ colors }) =>
      `linear-gradient(90deg, ${colors['pink-600']} 0%, ${colors['purple-600']} 50%, ${colors['pink-600']} 100%)`,
    backgroundSize: '300px 100px',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    textShadow: ({ colors }) =>
      `.1em -.075em ${colors.text}, .1em -.075em 1em ${colors.background}`,
  })
  .groups({ typography: true, layout: true, space: true })
  .asComponent('div');
