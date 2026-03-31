import { ds } from '../../ds';

export const Logo = ds
  .styles({
    fontFamily: 'logo',
    fontWeight: 700,
    lineHeight: 'none',
    letterSpacing: '2px',
    m: 0,
    width: 'max-content',
    background:
      'linear-gradient(90deg, {colors.primary} 0%, {colors.primary.hover} 25%, {colors.accent} 50%, {colors.primary.hover} 75%, {colors.primary} 100%)',
    backgroundSize: '400px 100px',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    textShadow: 'logo',
    animation: 'flow 5s linear infinite',
  })
  .system({ text: true, space: true })
  .props({
    logoSize: {
      property: 'fontSize',
      scale: { xs: 28, sm: 32, md: 64, lg: 72, xl: 96, xxl: 128 },
    },
  })
  .asElement('h1');
