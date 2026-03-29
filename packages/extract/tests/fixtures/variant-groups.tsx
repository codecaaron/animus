import { animus } from '@animus-ui/core';

// Variant with custom prop name + groups — reproduces StratumRow pattern
export const StratumRow = animus
  .styles({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    p: 16,
    borderColor: 'primary',
  })
  .variant({
    prop: 'kind',
    variants: {
      terminal: {
        borderColor: 'secondary',
      },
    },
  })
  .system({ space: true })
  .asElement('div');

// Variant with default prop name + groups
export const SimpleVariantGroups = animus
  .styles({ display: 'flex', p: 8 })
  .variant({
    variants: {
      filled: { bg: 'primary' },
      outlined: { borderColor: 'primary' },
    },
  })
  .system({ space: true })
  .asElement('div');

// Variant only (no groups) — control case
export const VariantOnly = animus
  .styles({ display: 'flex' })
  .variant({
    prop: 'kind',
    variants: {
      active: { color: 'primary' },
    },
  })
  .asElement('div');

// Groups only (no variant) — control case
export const GroupsOnly = animus
  .styles({ display: 'flex', p: 8 })
  .system({ space: true })
  .asElement('div');

// Variant with defaultVariant — reconciler tracks this for pruning
export const TrackedVariant = animus
  .styles({ display: 'flex' })
  .variant({
    prop: 'mode',
    defaultVariant: 'idle',
    variants: {
      idle: { color: 'primary' },
      active: { color: 'secondary' },
      disabled: { opacity: '0.5' },
    },
  })
  .asElement('div');
