import { animus } from '@animus-ui/core';

// Simple token alias in a compound border value
export const Card = animus
  .styles({
    border: '1px solid {colors.primary}',
    p: 16,
  })
  .asElement('div');

// Alpha modifier on a token alias
export const Overlay = animus
  .styles({
    background: '{colors.primary/50}',
    display: 'flex',
  })
  .asElement('div');

// Multiple aliases in one value (e.g., box-shadow compound)
export const Shadow = animus
  .styles({
    boxShadow: '0 4px 12px {colors.primary/20}',
    p: 8,
  })
  .asElement('div');

// Unresolved token alias — should pass through as-is
export const Broken = animus
  .styles({
    border: '1px solid {colors.nonexistent}',
    display: 'block',
  })
  .asElement('div');
