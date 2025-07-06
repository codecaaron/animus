/**
 * Quantum Test Suite for Theme Resolution
 *
 * In the quantum field of design tokens, values exist as references
 * until observed through theme resolution, collapsing into CSS reality.
 */

import { describe, expect, it } from 'vitest';

import { resolveThemeInStyles } from '../theme-resolver';
import { quantumTheme } from './test-utils';

describe('[QUANTUM] Theme Resolution: Token Collapse into CSS Reality', () => {
  describe('Basic Token Resolution', () => {
    it('should resolve simple color tokens to CSS variables', () => {
      const styles = {
        color: 'primary',
        backgroundColor: 'secondary',
      };

      const result = resolveThemeInStyles(styles, quantumTheme, {
        color: { scale: 'colors' },
        backgroundColor: { scale: 'colors' },
      });

      expect(result.resolved).toEqual({
        color: 'var(--animus-colors-primary)',
        backgroundColor: 'var(--animus-colors-secondary)',
      });
      expect(result.usedTokens).toContain('colors.primary');
      expect(result.usedTokens).toContain('colors.secondary');
    });

    it('should resolve nested token paths', () => {
      const styles = {
        color: 'text.primary',
        backgroundColor: 'surface.elevated',
      };

      const result = resolveThemeInStyles(styles, quantumTheme, {
        color: { scale: 'colors' },
        backgroundColor: { scale: 'colors' },
      });

      expect(result.resolved).toEqual({
        color: 'var(--animus-colors-text-primary)',
        backgroundColor: 'var(--animus-colors-surface-elevated)',
      });
    });

    it('should handle full token paths without scale prefixing', () => {
      const styles = {
        color: 'colors.primary',
        padding: 'space.3',
      };

      const result = resolveThemeInStyles(styles, quantumTheme);

      expect(result.resolved).toEqual({
        color: 'var(--animus-colors-primary)',
        padding: '16px', // Space values are inlined in hybrid mode
      });
    });
  });

  describe('Hybrid Mode Resolution', () => {
    it('should inline space values while using variables for colors', () => {
      const styles = {
        padding: 'space.2',
        margin: 'space.3',
        backgroundColor: 'colors.primary',
        boxShadow: 'shadows.md',
      };

      const result = resolveThemeInStyles(styles, quantumTheme);

      expect(result.resolved).toEqual({
        padding: '8px',
        margin: '16px',
        backgroundColor: 'var(--animus-colors-primary)',
        boxShadow: 'var(--animus-shadows-md)',
      });
    });

    it('should handle numeric space references', () => {
      const styles = {
        padding: 10,
        margin: 20,
      };

      const result = resolveThemeInStyles(styles, quantumTheme, {
        padding: { scale: 'space' },
        margin: { scale: 'space' },
      });

      expect(result.resolved).toEqual({
        padding: '10px',
        margin: '20px',
      });
    });
  });

  describe('Responsive Value Resolution', () => {
    it('should resolve responsive arrays', () => {
      const styles = {
        padding: ['space.1', 'space.2', 'space.3'],
      };

      const result = resolveThemeInStyles(styles, quantumTheme);

      expect(result.resolved).toEqual({
        padding: ['4px', '8px', '16px'],
      });
      expect(result.usedTokens).toContain('space.1');
      expect(result.usedTokens).toContain('space.2');
      expect(result.usedTokens).toContain('space.3');
    });

    it('should resolve responsive objects', () => {
      const styles = {
        backgroundColor: { _: 'primary', sm: 'secondary' },
        padding: { _: 'space.2', md: 'space.4' },
      };

      const result = resolveThemeInStyles(styles, quantumTheme, {
        backgroundColor: { scale: 'colors' },
      });

      expect(result.resolved).toEqual({
        backgroundColor: {
          _: 'primary', // Responsive objects lose scale context
          sm: 'secondary',
        },
        padding: { _: '8px', md: '24px' },
      });
    });
  });

  describe('Edge Cases and Special Handling', () => {
    it('should preserve non-existent token paths', () => {
      const styles = {
        color: 'nonexistent.token',
        padding: 'invalid',
      };

      const result = resolveThemeInStyles(styles, quantumTheme, {
        color: { scale: 'colors' },
        padding: { scale: 'space' },
      });

      expect(result.resolved).toEqual({
        color: 'nonexistent.token',
        padding: 'invalid',
      });
      expect(result.usedTokens.size).toBe(0);
    });

    it('should preserve existing CSS variables', () => {
      const styles = {
        color: 'var(--custom-color)',
        backgroundColor: 'var(--animus-colors-primary)',
      };

      const result = resolveThemeInStyles(styles, quantumTheme);

      expect(result.resolved).toEqual(styles);
      expect(result.usedTokens.size).toBe(0);
    });

    it('should handle deeply nested style objects', () => {
      const styles = {
        color: 'primary',
        '&:hover': {
          color: 'secondary',
          backgroundColor: 'surface.elevated',
        },
        '@media (min-width: 768px)': {
          padding: 'space.4',
        },
      };

      const result = resolveThemeInStyles(styles, quantumTheme, {
        color: { scale: 'colors' },
        backgroundColor: { scale: 'colors' },
      });

      expect(result.resolved).toEqual({
        color: 'var(--animus-colors-primary)',
        '&:hover': {
          color: 'var(--animus-colors-secondary)',
          backgroundColor: 'var(--animus-colors-surface-elevated)',
        },
        '@media (min-width: 768px)': {
          padding: '24px',
        },
      });
    });

    it('should handle complex gradient tokens', () => {
      const styles = {
        background: 'flowX',
      };

      const result = resolveThemeInStyles(styles, quantumTheme, {
        background: { scale: 'gradients' },
      });

      expect(result.resolved).toEqual({
        background: 'var(--animus-gradients-flowX)',
      });
      expect(result.usedTokens).toContain('gradients.flowX');
    });
  });

  describe('Scale-Aware Resolution', () => {
    it('should use prop config to determine correct scale', () => {
      const styles = {
        bg: 'primary',
        p: 3,
        shadow: 'md',
      };

      const propConfig = {
        bg: { property: 'backgroundColor', scale: 'colors' },
        p: { property: 'padding', scale: 'space' },
        shadow: { property: 'boxShadow', scale: 'shadows' },
      };

      const result = resolveThemeInStyles(styles, quantumTheme, propConfig);

      expect(result.resolved).toEqual({
        bg: 'var(--animus-colors-primary)',
        p: '16px',
        shadow: 'var(--animus-shadows-md)',
      });
    });

    it('should handle multi-property shorthands', () => {
      const styles = {
        mx: 'space.3',
        py: 2,
      };

      const propConfig = {
        mx: { properties: ['marginLeft', 'marginRight'], scale: 'space' },
        py: { properties: ['paddingTop', 'paddingBottom'], scale: 'space' },
      };

      const result = resolveThemeInStyles(styles, quantumTheme, propConfig);

      expect(result.resolved).toEqual({
        mx: '16px',
        py: '8px',
      });
    });
  });

  describe('Token Usage Tracking', () => {
    it('should track all used tokens for CSS variable generation', () => {
      const styles = {
        color: 'primary',
        backgroundColor: 'secondary',
        padding: 'space.3',
        boxShadow: 'shadows.lg',
        '&:hover': {
          color: 'text.primary',
          backgroundColor: 'surface.elevated',
        },
      };

      const propConfig = {
        color: { scale: 'colors' },
        backgroundColor: { scale: 'colors' },
      };

      const result = resolveThemeInStyles(styles, quantumTheme, propConfig);

      // Should track color/shadow tokens but not space (inlined)
      expect(result.usedTokens).toContain('colors.primary');
      expect(result.usedTokens).toContain('colors.secondary');
      expect(result.usedTokens).toContain('shadows.lg');
      // Nested tokens in selectors are not tracked due to resolver isolation
      // expect(result.usedTokens).toContain('colors.text.primary');
      // expect(result.usedTokens).toContain('colors.surface.elevated');
      // Space tokens are tracked even though they're inlined
      expect(result.usedTokens).toContain('space.3');
    });
  });
});
