import { ds } from '../../ds';

export const GlowText = ds
  .styles({
    fontFamily: 'logo',
    fontWeight: 700,
    lineHeight: 'tight',
    letterSpacing: '2px',
    width: 'max-content',
    animation: 'flow 5s linear infinite',
    background:
      'linear-gradient(90deg, {colors.primary} 0%, {colors.primary-hover} 25%, {colors.accent} 50%, {colors.primary-hover} 75%, {colors.primary} 100%)',
    backgroundSize: '400px 100px',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    textShadow: 'logo',
  })
  .variant({
    variants: {
      logo: {
        textTransform: 'lowercase',
      },
      mono: {
        textTransform: 'none',
      },
    },
  })
  .variant({ prop: 'test', variants: { cool: {} } })
  .groups({ text: true, space: true })
  .asElement('span');
