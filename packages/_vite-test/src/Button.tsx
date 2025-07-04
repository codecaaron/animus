import { animus } from '@animus-ui/core';

export const Button = animus
  .styles({
    padding: '8px 16px',
    backgroundColor: 'blue',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  })
  .variant({ prop: 'size', variants: { small: { padding: '4px 8px' } } })
  .states({ disabled: { opacity: 0.5 } })
  .groups({ space: true, color: true, background: true })
  .asElement('button');

// Extended component that inherits all Button styles
export const PrimaryButton = Button.extend()
  .styles({
    backgroundColor: 'darkblue',
    fontWeight: 'bold',
  })
  .asElement('button');
