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
    fontFamily: 'monospace',
    letterSpacing: '1px',
    backgroundImage: ({ colors }) =>
      `linear-gradient(90deg, ${colors.tertiary} 0%, ${colors.primary} 50%, ${colors.tertiary} 100%)`,
    backgroundSize: '300px 100px',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  })
  .variant({
    prop: 'shadow',
    variants: {
      sm: {
        textShadow: ({ colors }) =>
          `2px -2px ${colors.text}, 2px -2px 4px ${colors.background}`,
      },
      md: {
        textShadow: ({ colors }) =>
          `3px -3px ${colors.text}, 3px -3px 6px ${colors.background}`,
      },
    },
  })
  .groups({ typography: true, layout: true, space: true })
  .asComponent('div');

FlowText.defaultProps = {
  shadow: 'sm',
};
