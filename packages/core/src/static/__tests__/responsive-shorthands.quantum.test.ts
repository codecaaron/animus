/**
 * Quantum Test Suite for Responsive Shorthands
 *
 * In the quantum field of responsive design, values exist in
 * superposition across all breakpoints until observed.
 */

import { describe, expect, it } from 'vitest';

import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { testColor, testGroups, testSpace, testTheme } from './test-utils';

describe('[QUANTUM] Responsive Shorthands: Values Across Dimensional Breakpoints', () => {
  const generator = new CSSGenerator();

  describe('CSS Shorthand Expansion', () => {
    it('should expand margin shorthands in quantum space', () => {
      const code = `
        const Box = animus
          .styles({
            m: 16,
            mx: 24,
            my: 32,
            mt: 8,
            mb: 12,
            mr: 4,
            ml: 6
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });

    it('should expand padding shorthands in quantum space', () => {
      const code = `
        const Box = animus
          .styles({
            p: 16,
            px: 24,
            py: 32,
            pt: 8,
            pb: 12,
            pr: 4,
            pl: 6
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });

    it('should expand other shorthands across dimensions', () => {
      const code = `
        const Box = animus
          .styles({
            bg: 'primary',
            size: 48,
            area: 'sidebar',
            inset: 0
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });
  });

  describe('Responsive Array Syntax', () => {
    it('should handle array values across quantum breakpoints', () => {
      const code = `
        const Box = animus
          .styles({
            padding: [10, 20, 30],
            margin: [0, 10, 20, 40]
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });

    it('should handle sparse arrays in quantum superposition', () => {
      const code = `
        const Box = animus
          .styles({
            padding: [5, , 15],
            margin: [0, , , 32]
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });

    it('should handle shorthand arrays', () => {
      const code = `
        const Box = animus
          .styles({
            mx: [10, 20, 30],
            py: [5, 10, 15, 20]
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });
  });

  describe('Responsive Object Syntax', () => {
    it('should handle object breakpoint values', () => {
      const code = `
        const Box = animus
          .styles({
            padding: { _: 10, sm: 20, lg: 40 },
            margin: { _: 0, md: 32 }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });

    it('should handle shorthand objects across dimensions', () => {
      const code = `
        const Box = animus
          .styles({
            mx: { _: 'auto', sm: 16, lg: 32 },
            py: { _: 8, md: 16 }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });

    it('should mix object and static values', () => {
      const code = `
        const Box = animus
          .styles({
            padding: { _: 10, sm: 20 },
            margin: 0,
            backgroundColor: 'white'
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });
  });

  describe('Complex Nested Responsive Styles', () => {
    it('should handle responsive values in variants', () => {
      const code = `
        const Button = animus
          .styles({ padding: [8, 12, 16] })
          .variant({
            prop: 'size',
            variants: {
              small: { padding: [4, 6, 8] },
              large: { padding: [12, 16, 24] }
            }
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });

    it('should handle responsive values in states', () => {
      const code = `
        const Box = animus
          .styles({ padding: { _: 16, md: 24 } })
          .states({
            expanded: {
              padding: { _: 24, md: 32, lg: 48 }
            }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });

    it('should handle deeply nested responsive pseudo-selectors', () => {
      const code = `
        const Card = animus
          .styles({
            padding: [16, 24, 32],
            '&:hover': {
              padding: [20, 28, 36],
              backgroundColor: { _: 'lightgray', sm: 'lightblue' }
            }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });
  });

  describe('Atomic Utilities with Responsive Values', () => {
    it('should generate atomic utilities from groups', () => {
      const code = `
        const Box = animus
          .styles({})  // Extractor requires .styles() to detect component
          .groups({ space: true })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      expect(extracted[0].componentName).toBe('Box');
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });

    it('should handle custom props with responsive scale lookups', () => {
      const code = `
        const Box = animus
          .styles({})  // Extractor requires .styles() to detect component
          .props({
            gap: {
              property: 'gap',
              scale: 'space'
            }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      expect(extracted[0].componentName).toBe('Box');
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });
  });
});
