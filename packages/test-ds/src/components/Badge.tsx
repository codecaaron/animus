import { ds } from '../system';

export const Badge = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    px: 8,
    py: 4,
    borderRadius: '9999px',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: '1',
  })
  .variant({
    prop: 'color',
    variants: {
      neutral: { bg: 'surface', color: 'text' },
      danger: { bg: 'danger', color: 'background' },
    },
  })
  .states({
    disabled: { opacity: '0.5', cursor: 'not-allowed' },
    active: { outline: '2px solid', outlineColor: 'primary' },
  })
  .asElement('span');
