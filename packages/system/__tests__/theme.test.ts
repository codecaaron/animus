/**
 * Snapshot tests for the ThemeBuilder's load-bearing return shapes.
 *
 * These catch regressions in:
 * - _variables (CSS variable declarations for :root, color modes, breakpoints)
 * - _tokens (raw values for color mode resolution)
 * - serializeTokens (token→var() reference + variable map generation)
 * - The full .build() shape
 *
 * If a snapshot changes, verify the extraction pipeline still produces
 * correct CSS variables: `bun run verify:showcase`
 */
import { describe, expect, it } from 'bun:test';

import { createTheme } from '../src';
import { serializeTokens } from '../src/theme/serializeTokens';

// ─── Fixtures ────────────────────────────────────────────────

const base = {
  breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
} as const;

/**
 * Representative theme chain matching showcase complexity:
 * scales + colors + color modes + nested color objects
 */
function buildTestTheme() {
  return createTheme(base)
    .addScale('space', () => ({
      0: '0',
      4: '0.25rem',
      8: '0.5rem',
      16: '1rem',
    }))
    .addScale('fontSizes', () => ({
      14: '0.875rem',
      16: '1rem',
      24: '1.5rem',
    }))
    .addScale('fonts', () => ({
      body: 'Georgia, serif',
      mono: 'monospace',
    }))
    .addColors({
      void: '#000000',
      ember: '#ff2800',
      bone: '#e8e0d0',
      gray: { 300: '#666666', 600: '#333333' },
    })
    .addColorModes('dark', {
      dark: {
        primary: 'ember',
        bg: 'void',
        muted: 'gray-300',
      },
      light: {
        primary: 'void',
        bg: 'bone',
        muted: 'gray-600',
      },
    })
    .build();
}

// ─── Tests ───────────────────────────────────────────────────

describe('ThemeBuilder.build() shape', () => {
  const theme = buildTestTheme();

  it('produces _variables with root, mode, and breakpoints', () => {
    expect(theme._variables).toMatchSnapshot();
  });

  it('produces _tokens with raw color values and mode mappings', () => {
    expect(theme._tokens).toMatchSnapshot();
  });

  it('produces color references as CSS var() calls', () => {
    expect(theme.colors).toMatchSnapshot();
  });

  it('produces complete build output', () => {
    // Exclude _getColorValue (function) for snapshot stability
    const { _getColorValue, ...snapshotSafe } = theme;
    expect(snapshotSafe).toMatchSnapshot();
  });
});

describe('ThemeBuilder._variables structure', () => {
  const theme = buildTestTheme();

  it('root contains color variable declarations', () => {
    expect(Object.keys(theme._variables.root).length).toBeGreaterThan(0);
    // Every root key is a CSS custom property
    for (const key of Object.keys(theme._variables.root)) {
      expect(key).toMatch(/^--/);
    }
  });

  it('mode contains semantic color aliases as var() references', () => {
    expect(Object.keys(theme._variables.mode).length).toBeGreaterThan(0);
    for (const value of Object.values(theme._variables.mode)) {
      expect(value).toMatch(/^var\(--/);
    }
  });

  it('breakpoints contains px-suffixed values', () => {
    expect(Object.keys(theme._variables.breakpoints)).toHaveLength(5);
    for (const value of Object.values(theme._variables.breakpoints)) {
      expect(value).toMatch(/px$/);
    }
  });
});

describe('serializeTokens', () => {
  it('produces token references and variable declarations', () => {
    const result = serializeTokens(
      { red: '#f00', blue: '#00f' },
      'color',
      { breakpoints: base.breakpoints }
    );
    expect(result).toMatchSnapshot();
  });

  it('handles nested/flattened color objects', () => {
    const result = serializeTokens(
      { 'gray-300': '#666', 'gray-600': '#333' },
      'color',
      { breakpoints: base.breakpoints }
    );
    expect(result).toMatchSnapshot();
  });
});

describe('createTheme minimal', () => {
  it('breakpoints-only theme has _variables.breakpoints', () => {
    const theme = createTheme(base).build();
    expect(theme._variables).toMatchSnapshot();
  });
});
