import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { minimalSpace, testTheme } from './testConfig';

describe('Responsive Values and CSS Shorthands', () => {
  let generator: CSSGenerator;

  beforeEach(() => {
    generator = new CSSGenerator();
  });

  describe('CSS Shorthand Expansion', () => {
    it('expands margin shorthands correctly', () => {
      const code = `
        const Box = animus
          .styles({
            m: 0,
            mx: 10,
            my: 20,
            mt: 5,
            mb: 15,
            mr: 25,
            ml: 35,
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('margin-shorthand-expansion');
    });

    it('expands padding shorthands correctly', () => {
      const code = `
        const Box = animus
          .styles({
            p: 10,
            px: 20,
            py: 30,
            pt: 15,
            pl: 25,
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('padding-shorthand-expansion');
    });

    it('expands other shorthands (bg, size, area, inset)', () => {
      const code = `
        const Component = animus
          .styles({
            bg: 'red',
            size: 100,
            area: 'header',
            inset: 0,
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('other-shorthand-expansion');
    });
  });

  describe('Responsive Array Syntax', () => {
    it('generates media queries for array syntax', () => {
      const code = `
        const Box = animus
          .styles({
            padding: [10, 20, 30],
            margin: [5, , 15], // sparse array
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('responsive-array-syntax');
    });

    it('handles responsive arrays with shorthands', () => {
      const code = `
        const Box = animus
          .styles({
            mx: [10, 20],
            py: [5, , 15],
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('responsive-array-shorthands');
    });
  });

  describe('Responsive Object Syntax', () => {
    it('generates media queries for object syntax', () => {
      const code = `
        const Box = animus
          .styles({
            padding: { _: 10, sm: 20, lg: 40 },
            margin: { _: 0, md: 'auto' },
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('responsive-object-syntax');
    });

    it('handles object syntax with shorthands', () => {
      const code = `
        const Box = animus
          .styles({
            mx: { _: 'auto', md: 20 },
            bg: { _: 'white', sm: 'gray', lg: 'black' },
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('responsive-object-shorthands');
    });
  });

  describe('Complex Nested Responsive Styles', () => {
    it('handles responsive values in pseudo-selectors', () => {
      const code = `
        const Button = animus
          .styles({
            padding: [10, 20],
            '&:hover': {
              bg: { _: 'gray', md: 'blue' },
              transform: 'scale(1.05)',
            },
            '&:active': {
              transform: { _: 'scale(0.95)', lg: 'scale(0.98)' },
            },
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('responsive-nested-selectors');
    });
  });

  describe('Atomic Utilities with Shorthands', () => {
    it('generates atomic utilities for shorthand properties', () => {
      const code = `
        const Box = animus
          .styles({
            display: 'flex',
          })
          .groups({
            space: true,
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      // Use only mx and py to demonstrate shorthand expansion
      const groupDefs = {
        space: {
          mx: minimalSpace.mx,
          py: minimalSpace.py,
        },
      };
      const result = generator.generateFromExtracted(
        extracted[0],
        groupDefs,
        testTheme
      );
      expect(result.css).toMatchSnapshot('atomic-shorthand-utilities');
    });
  });
});
