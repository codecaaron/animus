import { expect } from 'vitest';

import { tokens } from '../fixtures/setup';

function getColorTokenNames(): string[] {
  const serialized = tokens.serialize();
  const variableMap: Record<string, string> = JSON.parse(
    serialized.variableMapJson
  );

  const colorNames = new Set<string>();
  for (const key of Object.keys(variableMap)) {
    if (key.startsWith('colors.')) {
      colorNames.add(key.replace('colors.', ''));
    }
  }

  return [...colorNames];
}

const COLOR_TOKENS = getColorTokenNames();

/** Fails when CSS carries a bare token name as a value (`color: primary;`)
 *  instead of the resolved `var(--color-primary)` reference. */
export function assertNoUnresolvedTokens(css: string) {
  for (const token of COLOR_TOKENS) {
    const pattern = new RegExp(`:\\s*${token}\\s*;`, 'g');
    expect(css).not.toMatch(pattern);
  }
}
