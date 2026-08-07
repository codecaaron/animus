import { ds } from '../ds';

// App-local ancestor/repeated-subject fixture (nested-selector-resolution):
// the raw ancestor key must emit with the composed class at the subject
// position (`[data-active="true"] .animus-ActiveItem-…`), and the
// repeated-subject key must substitute the class at EVERY unquoted `&`
// (`.animus-ActiveItem-… + .animus-ActiveItem-…`). The test-ds GroupItem
// covers the same family cross-package plus the registered-alias path; this
// sibling proves the raw keys work authored directly in the consumer app. No
// literal `&` may survive into the produced stylesheet.
export const ActiveItem = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    px: 8,
    py: 4,
    borderRadius: '4px',
    bg: 'surface',
    color: 'text',
    '[data-active="true"] &': {
      bg: 'primary',
      color: 'background',
    },
    '& + &': { ml: 8 },
  })
  .asElement('span');
