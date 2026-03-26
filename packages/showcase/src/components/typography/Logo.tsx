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
      'linear-gradient(90deg, #FF2800 0%, #E63946 25%, #FFB627 50%, #E63946 75%, #FF2800 100%)',
    backgroundSize: '400px 100px',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    textShadow: 'logo',
    animation: 'flow 5s linear infinite',
  })
  .groups({ text: true, space: true })
  .asElement('h1');
