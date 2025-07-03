import { animus } from '../../../../index';

export const TestButton = animus
  .styles({
    padding: '8px 16px',
    borderRadius: '4px',
    backgroundColor: 'primary',
    color: 'text.primary',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  })
  .variant({
    prop: 'variant',
    variants: {
      primary: {
        backgroundColor: 'primary',
        color: 'white',
      },
      secondary: {
        backgroundColor: 'secondary',
        color: 'text.primary',
      },
    },
  })
  .variant({
    prop: 'size',
    variants: {
      small: {
        padding: '4px 8px',
        fontSize: 14,
      },
      large: {
        padding: '12px 24px',
        fontSize: 18,
      },
    },
  })
  .states({
    disabled: {
      opacity: 0.6,
      cursor: 'not-allowed',
    },
  })
  .groups({
    space: true,
    color: true,
  })
  .asElement('button');
