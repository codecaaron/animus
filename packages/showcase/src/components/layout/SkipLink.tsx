import { ds } from '../../ds';

export const SkipLink = ds
  .styles({
    position: 'fixed',
    top: '-100%',
    left: '16px',
    zIndex: '9999',
    fontFamily: 'mono',
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    textDecoration: 'none',
    color: 'text',
    bg: 'surface',
    border: 1,
    borderColor: 'border',
    px: 16,
    py: 8,
    transition: 'top 0.15s ease',
    _focusVisible: {
      top: '12px',
      outline: '2px solid',
      outlineColor: 'primary',
      outlineOffset: '2px',
    },
  })
  .asElement('a');
