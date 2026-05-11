import { ds } from '../system';

export const Alert = ds
  .styles({
    display: 'flex',
    alignItems: 'flex-start',
    p: 12,
    borderRadius: '4px',
    fontSize: 14,
    lineHeight: '1.5',
  })
  .variant({
    prop: 'variant',
    variants: {
      filled: { color: 'background' },
      outline: { bg: 'transparent', borderWidth: '1px', borderStyle: 'solid' },
    },
  })
  .variant({
    prop: 'intent',
    variants: {
      info: { bg: 'primary' },
      danger: { bg: 'danger' },
      success: { bg: 'secondary' },
    },
  })
  .compound(
    { variant: 'outline', intent: 'info' },
    { borderColor: 'primary', color: 'primary' }
  )
  .compound(
    { variant: 'outline', intent: 'danger' },
    { borderColor: 'danger', color: 'danger' }
  )
  .compound(
    { variant: 'outline', intent: 'success' },
    { borderColor: 'secondary', color: 'secondary' }
  )
  .asElement('div');
