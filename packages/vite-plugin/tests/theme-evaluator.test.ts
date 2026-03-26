import { describe, expect, it } from 'bun:test';

import { evaluateTheme } from '../src/theme-evaluator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock ssrLoadModule that returns the given theme object as the
 * named export `theme`.
 */
function mockLoader(themeObject: Record<string, any>) {
  return async (_path: string): Promise<Record<string, any>> => ({
    theme: themeObject,
  });
}

// ---------------------------------------------------------------------------
// Test 1 — theme with _variables produces :root CSS
// ---------------------------------------------------------------------------

describe('evaluateTheme — _variables → :root block', () => {
  it('emits all string values from all _variables categories into :root', async () => {
    const theme = {
      colors: {
        'navy-500': 'var(--color-navy-500)',
        primary: 'var(--color-primary)',
      },
      _variables: {
        root: {
          '--color-navy-500': '#282a36',
          '--color-hyper-500': '#ff79c6',
        },
        mode: {
          '--color-primary': 'var(--color-purple-700)',
          '--color-secondary': 'var(--color-hyper-500)',
        },
      },
    };

    const result = await evaluateTheme(mockLoader(theme), '/fake/theme.ts');

    expect(result.variableCss).toContain(':root {');
    expect(result.variableCss).toContain('  --color-navy-500: #282a36;');
    expect(result.variableCss).toContain('  --color-hyper-500: #ff79c6;');
    expect(result.variableCss).toContain(
      '  --color-primary: var(--color-purple-700);'
    );
    expect(result.variableCss).toContain(
      '  --color-secondary: var(--color-hyper-500);'
    );
  });

  it('returns scalesJson with flattened scale entries', async () => {
    const theme = {
      colors: {
        'navy-500': 'var(--color-navy-500)',
        primary: 'var(--color-primary)',
      },
      _variables: {
        root: { '--color-navy-500': '#282a36' },
      },
    };

    const result = await evaluateTheme(mockLoader(theme), '/fake/theme.ts');
    const scales = JSON.parse(result.scalesJson);

    // colors should be flattened as "colors.navy-500" etc.
    expect(scales['colors.navy-500']).toBe('var(--color-navy-500)');
    expect(scales['colors.primary']).toBe('var(--color-primary)');
  });
});

// ---------------------------------------------------------------------------
// Test 2 — theme with _tokens.modes produces [data-color-mode] blocks
// ---------------------------------------------------------------------------

describe('evaluateTheme — _tokens.modes → [data-color-mode] blocks', () => {
  it('emits a block for each non-default mode', async () => {
    const theme = {
      mode: 'light',
      _variables: {
        root: { '--color-navy-500': '#282a36' },
        mode: {
          '--color-primary': '#6b21a8', // light mode default
        },
      },
      _tokens: {
        modes: {
          light: { primary: '#6b21a8', secondary: '#ec4899' },
          dark: { primary: '#ff80bf', secondary: '#c084fc' },
        },
      },
    };

    const result = await evaluateTheme(mockLoader(theme), '/fake/theme.ts');

    // Should have a dark mode block
    expect(result.variableCss).toContain('[data-color-mode="dark"]');
    expect(result.variableCss).toContain('  --color-primary: #ff80bf;');
    expect(result.variableCss).toContain('  --color-secondary: #c084fc;');

    // All modes get explicit selectors (including default) so nested
    // elements can override the page-level mode
    expect(result.variableCss).toContain('[data-color-mode="light"]');
    expect(result.variableCss).toContain('  --color-primary: #6b21a8;');
  });

  it('emits all modes when theme.mode is absent', async () => {
    const theme = {
      // No `mode` property — all modes still get selectors
      _variables: {
        mode: { '--color-primary': '#6b21a8' },
      },
      _tokens: {
        modes: {
          light: { primary: '#6b21a8' },
          dark: { primary: '#ff80bf' },
        },
      },
    };

    const result = await evaluateTheme(mockLoader(theme), '/fake/theme.ts');

    // Both modes get explicit [data-color-mode] blocks
    expect(result.variableCss).toContain('[data-color-mode="dark"]');
    expect(result.variableCss).toContain('[data-color-mode="light"]');
  });
});

// ---------------------------------------------------------------------------
// Test 3 — theme without _variables returns empty variableCss
// ---------------------------------------------------------------------------

describe('evaluateTheme — no _variables', () => {
  it('returns empty variableCss when _variables is absent', async () => {
    const theme = {
      colors: { primary: '#6b21a8' },
      space: { '4': '0.25rem' },
    };

    const result = await evaluateTheme(mockLoader(theme), '/fake/theme.ts');

    expect(result.variableCss).toBe('');
  });

  it('still returns valid scalesJson when _variables is absent', async () => {
    const theme = {
      colors: { primary: '#6b21a8' },
      space: { '4': '0.25rem', '8': '0.5rem' },
    };

    const result = await evaluateTheme(mockLoader(theme), '/fake/theme.ts');

    const scales = JSON.parse(result.scalesJson);
    expect(scales['space.4']).toBe('0.25rem');
    expect(scales['space.8']).toBe('0.5rem');
    expect(scales['colors.primary']).toBe('#6b21a8');
  });
});

// ---------------------------------------------------------------------------
// Test 4 — nested semantic tokens flatten correctly
// ---------------------------------------------------------------------------

describe('evaluateTheme — nested mode tokens flatten with - separator', () => {
  it('handles background._ → --color-background and background.muted → --color-background-muted', async () => {
    const theme = {
      mode: 'light',
      _variables: {
        mode: {
          '--color-background': '#ffffff',
          '--color-background-muted': '#f5f5f5',
        },
      },
      _tokens: {
        modes: {
          light: {
            background: '#ffffff',
            'background-muted': '#f5f5f5',
          },
          dark: {
            // Using the nested structure the task spec mentions
            background: { _: '#1a1a1a', muted: '#2a2a2a' },
          },
        },
      },
    };

    const result = await evaluateTheme(mockLoader(theme), '/fake/theme.ts');

    expect(result.variableCss).toContain('[data-color-mode="dark"]');
    // background._ → --color-background
    expect(result.variableCss).toContain('  --color-background: #1a1a1a;');
    // background.muted → --color-background-muted
    expect(result.variableCss).toContain(
      '  --color-background-muted: #2a2a2a;'
    );
  });

  it('handles already-flat mode tokens with hyphen-separated keys', async () => {
    const theme = {
      mode: 'light',
      _variables: {
        mode: { '--color-primary': '#6b21a8' },
      },
      _tokens: {
        modes: {
          light: { primary: '#6b21a8', 'background-muted': '#f5f5f5' },
          dark: { primary: '#ff80bf', 'background-muted': '#2d2d2d' },
        },
      },
    };

    const result = await evaluateTheme(mockLoader(theme), '/fake/theme.ts');

    expect(result.variableCss).toContain('  --color-primary: #ff80bf;');
    expect(result.variableCss).toContain(
      '  --color-background-muted: #2d2d2d;'
    );
  });

  it('skips object values in _variables (e.g. breakpoint-responsive entries)', async () => {
    const theme = {
      _variables: {
        root: {
          '--color-navy-500': '#282a36',
          // Object value — should be skipped (not serializable as a CSS property value)
          '--responsive-color': { '@media (...)': '#ff0000' },
        },
      },
    };

    const result = await evaluateTheme(mockLoader(theme), '/fake/theme.ts');

    expect(result.variableCss).toContain('  --color-navy-500: #282a36;');
    // The object-valued entry must not appear
    expect(result.variableCss).not.toContain('--responsive-color');
  });
});
