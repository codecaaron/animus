import { Stack } from './Stack';

export const StackItem = Stack.extend()
  .styles({
    flexShrink: 0,
  })
  .variant({
    prop: 'emphasis',
    variants: {
      muted: { color: 'text.muted' },
      strong: { color: 'text', fontWeight: 700 },
    },
  })
  .asElement('div');
