import { describe, expect, it } from '@jest/globals';

import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { resolveThemeInStyles, StaticThemeResolver } from '../theme-resolver';

describe('Theme Resolution', () => {
  const generator = new CSSGenerator({
    themeResolution: { mode: 'hybrid' },
  });

  const theme = {
    colors: {
      primary: '#007bff',
      secondary: '#6c757d',
      text: {
        primary: '#212529',
        secondary: '#6c757d',
        muted: '#adb5bd',
      },
      surface: {
        primary: '#ffffff',
        secondary: '#f8f9fa',
        elevated: 'rgba(255, 255, 255, 0.95)',
      },
    },
    space: {
      xs: '0.25rem',
      sm: '0.5rem',
      md: '1rem',
      lg: '2rem',
      xl: '4rem',
    },
    shadows: {
      sm: '0 1px 2px rgba(0,0,0,0.05)',
      md: '0 4px 6px rgba(0,0,0,0.1)',
      lg: '0 10px 15px rgba(0,0,0,0.1)',
      elevation: {
        1: '0 1px 3px rgba(0,0,0,0.12)',
        2: '0 3px 6px rgba(0,0,0,0.16)',
        3: '0 10px 20px rgba(0,0,0,0.19)',
      },
    },
    gradients: {
      primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      flowX: 'linear-gradient(90deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
    },
  };

  describe('Direct Theme Resolution', () => {
    it('should resolve simple theme tokens', () => {
      const styles = {
        color: 'colors.text.primary',
        backgroundColor: 'colors.surface.primary',
        boxShadow: 'shadows.md',
      };

      const result = resolveThemeInStyles(styles, theme);

      expect(result.resolved).toEqual({
        color: 'var(--animus-colors-text-primary)', // Resolved as full path
        backgroundColor: 'var(--animus-colors-surface-primary)', // Resolved as full path
        boxShadow: 'var(--animus-shadows-md)', // Resolved as shadows.md
      });

      expect(result.usedTokens.has('shadows.md')).toBe(true);
      expect(result.usedTokens.has('colors.text.primary')).toBe(true);
      expect(result.usedTokens.has('colors.surface.primary')).toBe(true);
    });

    it('should handle nested theme paths', () => {
      const styles = {
        boxShadow: 'shadows.elevation.2',
        color: 'colors.text.muted',
      };

      const result = resolveThemeInStyles(styles, theme);

      expect(result.resolved).toEqual({
        boxShadow: 'var(--animus-shadows-elevation-2)',
        color: 'var(--animus-colors-text-muted)',
      });
    });
  });

  describe('CSS Variable Generation', () => {
    it('should generate CSS variables for colors in hybrid mode', () => {
      const resolver = new StaticThemeResolver(theme, { mode: 'hybrid' });

      const result1 = resolver.resolve('primary', 'colors');
      expect(result1.value).toBe('var(--animus-colors-primary)');
      expect(result1.cssVariable).toBe('--animus-colors-primary');

      const result2 = resolver.resolve('shadows.elevation.1');
      expect(result2.value).toBe('var(--animus-shadows-elevation-1)');

      const cssVars = resolver.generateCssVariableDeclarations();
      expect(cssVars).toContain('--animus-colors-primary: #007bff');
      expect(cssVars).toContain(
        '--animus-shadows-elevation-1: 0 1px 3px rgba(0,0,0,0.12)'
      );
    });

    it('should inline non-color values in hybrid mode', () => {
      const resolver = new StaticThemeResolver(theme, { mode: 'hybrid' });

      const result = resolver.resolve('md', 'space');
      expect(result.value).toBe('1rem'); // Inlined, not a CSS variable
      expect(result.cssVariable).toBeUndefined();
    });
  });

  describe('Integration with Generator', () => {
    it('should resolve theme tokens in extracted styles', () => {
      const code = `
        const ThemedCard = animus
          .styles({
            backgroundColor: 'colors.surface.elevated',
            color: 'colors.text.primary',
            padding: 'space.md',
            boxShadow: 'shadows.elevation.1'
          })
          .variant({
            prop: 'emphasis',
            variants: {
              high: {
                backgroundColor: 'colors.primary',
                color: 'white',
                boxShadow: 'shadows.lg'
              }
            }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0], {}, theme);

      // Base styles should have resolved theme values
      expect(result.css).toContain(
        'background-color: var(--animus-colors-surface-elevated)'
      );
      expect(result.css).toContain('color: var(--animus-colors-text-primary)');
      expect(result.css).toContain('padding: 1rem'); // Space values are inlined
      expect(result.css).toContain(
        'box-shadow: var(--animus-shadows-elevation-1)'
      );

      // Variant styles should also be resolved
      expect(result.css).toContain('var(--animus-colors-primary)');
      expect(result.css).toContain('var(--animus-shadows-lg)');

      // Should include CSS variables
      expect(result.cssVariables).toContain(':root {');
      expect(result.cssVariables).toContain(
        '--animus-colors-surface-elevated: rgba(255, 255, 255, 0.95)'
      );
    });
  });

  describe('Responsive Theme Values', () => {
    it('should resolve theme tokens in responsive arrays', () => {
      const styles = {
        padding: ['space.xs', 'space.sm', 'space.md'],
      };

      const result = resolveThemeInStyles(styles, theme);

      expect(result.resolved.padding).toEqual(['0.25rem', '0.5rem', '1rem']);
    });

    it('should resolve theme tokens in responsive objects', () => {
      const styles = {
        padding: { _: 'space.xs', sm: 'space.md', lg: 'space.xl' },
      };

      const result = resolveThemeInStyles(styles, theme);

      expect(result.resolved.padding).toEqual({
        _: '0.25rem',
        sm: '1rem',
        lg: '4rem',
      });
    });
  });

  describe('Scale-based Resolution', () => {
    it('should use scale from prop config', () => {
      const styles = {
        bg: 'primary',
        p: 'md',
      };

      const propConfig = {
        bg: { scale: 'colors' },
        p: { scale: 'space' },
      };

      const result = resolveThemeInStyles(styles, theme, propConfig);

      expect(result.resolved.bg).toBe('var(--animus-colors-primary)');
      expect(result.resolved.p).toBe('1rem');
    });

    it('should prefix nested paths with scale', () => {
      const styles = {
        color: 'text.primary',
        backgroundColor: 'surface.elevated',
      };

      const propConfig = {
        color: { scale: 'colors' },
        backgroundColor: { scale: 'colors' },
      };

      const result = resolveThemeInStyles(styles, theme, propConfig);

      // Should resolve colors.text.primary and colors.surface.elevated
      expect(result.resolved.color).toBe('var(--animus-colors-text-primary)');
      expect(result.resolved.backgroundColor).toBe(
        'var(--animus-colors-surface-elevated)'
      );

      // Should track the full paths
      expect(result.usedTokens.has('colors.text.primary')).toBe(true);
      expect(result.usedTokens.has('colors.surface.elevated')).toBe(true);
    });

    it('should not double-prefix if scale is already in path', () => {
      const styles = {
        color: 'colors.primary',
      };

      const propConfig = {
        color: { scale: 'colors' },
      };

      const result = resolveThemeInStyles(styles, theme, propConfig);

      // Should not become colors.colors.primary
      expect(result.resolved.color).toBe('var(--animus-colors-primary)');
      expect(result.usedTokens.has('colors.primary')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-existent theme paths', () => {
      const styles = {
        color: 'colors.nonexistent',
        padding: 'space.huge',
      };

      const result = resolveThemeInStyles(styles, theme);

      // Non-existent paths should be left as-is
      expect(result.resolved.color).toBe('colors.nonexistent');
      expect(result.resolved.padding).toBe('space.huge');
    });

    it('should handle numeric values', () => {
      const styles = {
        padding: 16,
        opacity: 0.5,
      };

      const result = resolveThemeInStyles(styles, theme);

      expect(result.resolved.padding).toBe('16');
      expect(result.resolved.opacity).toBe('0.5');
    });

    it('should handle theme values that are already CSS variables', () => {
      const themeWithVars = {
        colors: {
          primary: 'var(--brand-primary)',
          secondary: 'var(--brand-secondary)',
        },
      };

      const styles = {
        color: 'colors.primary',
      };

      const result = resolveThemeInStyles(styles, themeWithVars);

      // Should preserve the CSS variable reference
      expect(result.resolved.color).toBe('var(--brand-primary)');
    });
  });
});
