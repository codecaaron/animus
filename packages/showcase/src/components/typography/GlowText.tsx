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
      'linear-gradient(90deg, #FF2800 0%, #E63946 25%, #FFB627 50%, #E63946 75%, #FF2800 100%)',
    backgroundSize: '400px 100px',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    textShadow: 'logo',
  })
  .groups({ text: true, space: true })
  .asElement('span');
