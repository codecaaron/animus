/**
 * Token invariant guard: asserts that CSS output does not contain
 * raw unresolved token names as property values.
 *
 * Derives the token list from the shared theme fixture, not a
 * hand-maintained list. If the theme gains new color names,
 * this guard automatically covers them.
 */
import { expect } from 'bun:test';

import { tokens } from '../fixtures/setup';

/**
 * Extract color scale names from the serialized theme.
 * These are the names that, if they appear as bare CSS property values,
 * indicate an unresolved token reference.
 */
function getColorTokenNames(): string[] {
  const serialized = tokens.serialize();
  const variableMap: Record<string, string> = JSON.parse(
    serialized.variableMapJson
  );

  // Extract color token names from variable map keys like "colors.primary"
  const colorNames = new Set<string>();
  for (const key of Object.keys(variableMap)) {
    if (key.startsWith('colors.')) {
      colorNames.add(key.replace('colors.', ''));
    }
  }

  return [...colorNames];
}

const COLOR_TOKENS = getColorTokenNames();

/**
 * Assert that CSS output does not contain raw unresolved token names
 * as bare property values. A property value like `background-color: primary;`
 * indicates the token was not resolved to `var(--color-primary)`.
 *
 * This catches the "dishonest fixture" problem where a component references
 * a token name that doesn't exist in the theme, and the Rust crate emits
 * the raw string instead of a CSS variable reference.
 */
export function assertNoUnresolvedTokens(css: string) {
  for (const token of COLOR_TOKENS) {
    // Match patterns like "property: tokenName;" where tokenName is a bare word
    // Exclude var() references and multi-word values
    const pattern = new RegExp(`:\\s*${token}\\s*;`, 'g');
    expect(css).not.toMatch(pattern);
  }
}
