import { ds } from '../../ds';

export const CodeFrame = ds
  .styles({
    position: 'relative',
    isolation: 'isolate',
    border: 1,
    borderColor: 'border',
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
        'linear-gradient(90deg, {colors.primary} 0%, {colors.primary-hover} 25%, {colors.accent} 50%, {colors.primary-hover} 75%, {colors.primary} 100%)',
      backgroundSize: '400px 100px',
      zIndex: '-1',
    },
  })
  .system({ space: true })
  .asElement('div');
