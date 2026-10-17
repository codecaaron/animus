import { describe, expect, test } from 'vitest';

import { marker } from '../src';

describe('marker', () => {
  // Contract: each relation's selector, with the marker inside `:where()`
  // so the relation adds no specificity beyond the component's class.
  test('marker relations emit their :where() selector shapes', () => {
    const row = marker('row');
    expect(row.className).toBe('animus-marker-row');
    expect(row.ancestor(':hover')).toBe('&:where(.animus-marker-row:hover *)');
    expect(row.descendant(':focus-visible')).toBe(
      '&:where(:has(.animus-marker-row:focus-visible))'
    );
    expect(row.siblingBefore('[aria-invalid="true"]')).toBe(
      '&:where(.animus-marker-row[aria-invalid="true"] ~ *)'
    );
    expect(row.siblingAfter(':checked')).toBe(
      '&:where(:has(~ .animus-marker-row:checked))'
    );
    expect(row.anySibling(':active')).toBe(
      '&:where(.animus-marker-row:active ~ *, :has(~ .animus-marker-row:active))'
    );
  });
});
