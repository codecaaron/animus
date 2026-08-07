import { ds } from '../system';

// Ancestor-subject recipe (nested-selector-resolution): every selector form
// here places the composed class at a NON-LEADING subject position, so each
// emitted rule must contain the class substituted at the `&` with the ancestor
// prefix preserved — and no literal `&` may survive into any produced
// stylesheet.
//
// Three consumer paths, one component:
// - a RAW ancestor key (`'[data-active="true"] &'`) — needs no registration,
//   emits through any extracting system;
// - the two REGISTERED ancestor aliases (`_groupHover`, `_dark`) from
//   system.ts — these only emit when the extracting (merged) system carries
//   the kit's `addSelectors()` registrations, making this the cross-package
//   alias witness for consumers that `.extend()` the kit.
export const GroupItem = ds
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
    _groupHover: { opacity: '0.9' },
    _dark: { color: 'text.muted' },
  })
  .asElement('span');
