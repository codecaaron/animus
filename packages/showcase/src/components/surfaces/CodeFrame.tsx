import { ds } from '../../ds';

export const CodeFrame = ds
  .styles({
    position: 'relative',
    isolation: 'isolate',
    pb: 16,
    pl: 16,
    '& > *:first-child': {
      position: 'relative',
    },
    '&:before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      top: 16,
      right: 16,
      animation: 'flow 5s linear infinite',
      background:
        'linear-gradient(90deg, #FF2800 0%, #E63946 25%, #FFB627 50%, #E63946 75%, #FF2800 100%)',
      backgroundSize: '400px 100px',
      zIndex: '-1',
    },
  })
  .groups({ space: true })
  .asElement('div');
