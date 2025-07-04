import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { minimalSpace, testTheme } from './testConfig';

describe('Animus Static Extraction', () => {
  describe('Style Extraction', () => {
    it('extracts basic styles', () => {
      const code = `
        const Button = animus
          .styles({
            padding: 10,
            color: 'blue',
            fontSize: 16
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);

      // Assert extraction structure instead of snapshot
      expect(extracted).toHaveLength(1);
      expect(extracted[0]).toEqual({
        componentName: 'Button',
        baseStyles: {
          padding: 10,
          color: 'blue',
          fontSize: 16,
        },
      });
    });

    it('extracts pseudo-selectors', () => {
      const code = `
        const Link = animus
          .styles({
            color: 'blue',
            textDecoration: 'none',
            '&:hover': {
              color: 'darkblue',
              textDecoration: 'underline'
            },
            '&:active': {
              color: 'purple'
            }
          })
          .asElement('a');
      `;

      const extracted = extractStylesFromCode(code);

      // Assert extraction structure instead of snapshot
      expect(extracted).toHaveLength(1);
      expect(extracted[0]).toEqual({
        componentName: 'Link',
        baseStyles: {
          color: 'blue',
          textDecoration: 'none',
          '&:hover': {
            color: 'darkblue',
            textDecoration: 'underline',
          },
          '&:active': {
            color: 'purple',
          },
        },
      });
    });

    it('extracts responsive values', () => {
      const code = `
        const ResponsiveBox = animus
          .styles({
            padding: { _: 10, sm: 20, md: 30 },
            margin: [5, 10, 15, 20],
            fontSize: 16
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);

      // Assert extraction structure instead of snapshot
      expect(extracted).toHaveLength(1);
      expect(extracted[0]).toEqual({
        componentName: 'ResponsiveBox',
        baseStyles: {
          padding: { _: 10, sm: 20, md: 30 },
          margin: [5, 10, 15, 20],
          fontSize: 16,
        },
      });
    });

    it('extracts variants', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px',
            border: 'none'
          })
          .variant({
            prop: 'size',
            variants: {
              small: { padding: '4px 8px', fontSize: 14 },
              large: { padding: '12px 24px', fontSize: 18 }
            }
          })
          .variant({
            prop: 'color',
            variants: {
              primary: { backgroundColor: 'blue', color: 'white' },
              secondary: { backgroundColor: 'gray', color: 'black' }
            }
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);

      // Assert extraction structure instead of snapshot
      expect(extracted).toHaveLength(1);
      const buttonStyle = extracted[0] as any;

      expect(buttonStyle.componentName).toBe('Button');
      expect(buttonStyle.baseStyles).toEqual({
        padding: '8px 16px',
        border: 'none',
      });

      // Verify both variants are extracted
      expect(buttonStyle.variants).toHaveLength(2);

      // Check size variant
      expect(buttonStyle.variants[0]).toEqual({
        prop: 'size',
        variants: {
          small: { padding: '4px 8px', fontSize: 14 },
          large: { padding: '12px 24px', fontSize: 18 },
        },
      });

      // Check color variant
      expect(buttonStyle.variants[1]).toEqual({
        prop: 'color',
        variants: {
          primary: { backgroundColor: 'blue', color: 'white' },
          secondary: { backgroundColor: 'gray', color: 'black' },
        },
      });
    });

    it('extracts states', () => {
      const code = `
        const Input = animus
          .styles({
            padding: '8px',
            border: '1px solid gray'
          })
          .states({
            disabled: { opacity: 0.5, cursor: 'not-allowed' },
            error: { borderColor: 'red' },
            focus: { borderColor: 'blue', outline: 'none' }
          })
          .asElement('input');
      `;

      const extracted = extractStylesFromCode(code);

      // Assert extraction structure instead of snapshot
      expect(extracted).toHaveLength(1);
      expect(extracted[0]).toEqual({
        componentName: 'Input',
        baseStyles: {
          padding: '8px',
          border: '1px solid gray',
        },
        states: {
          disabled: { opacity: 0.5, cursor: 'not-allowed' },
          error: { borderColor: 'red' },
          focus: { borderColor: 'blue', outline: 'none' },
        },
      });
    });

    it('extracts groups and props', () => {
      const code = `
        const Box = animus
          .styles({
            display: 'flex'
          })
          .groups({
            space: true,
            color: true
          })
          .props({
            gap: { property: 'gap', scale: 'space' }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);

      // Assert extraction structure instead of snapshot
      expect(extracted).toHaveLength(1);
      expect(extracted[0]).toEqual({
        componentName: 'Box',
        baseStyles: {
          display: 'flex',
        },
        groups: ['space', 'color'],
        props: {
          gap: { property: 'gap', scale: 'space' },
        },
      });
    });
  });

  describe('CSS Generation', () => {
    let generator: CSSGenerator;

    beforeEach(() => {
      generator = new CSSGenerator();
    });

    it('generates component CSS', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px',
            backgroundColor: 'blue',
            color: 'white',
            '&:hover': {
              backgroundColor: 'darkblue'
            }
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('component-css-generation');
    });

    it('generates CSS with variants', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px'
          })
          .variant({
            prop: 'size',
            variants: {
              small: { padding: '4px 8px' },
              large: { padding: '12px 24px' }
            }
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('variant-css-generation');
    });

    it('generates CSS with states', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px'
          })
          .states({
            disabled: { opacity: 0.5 },
            loading: { cursor: 'wait' }
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('state-css-generation');
    });

    it('generates atomic utilities for groups', () => {
      const code = `
        const Box = animus
          .styles({
            display: 'flex'
          })
          .groups({
            space: true
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const groupDefs = { space: minimalSpace };
      const result = generator.generateFromExtracted(
        extracted[0],
        groupDefs,
        testTheme
      );
      expect(result.css).toMatchSnapshot('atomic-utilities-generation');
    });

    it('demonstrates shorthand expansion in utilities', () => {
      const code = `
        const Container = animus
          .styles({
            width: '100%'
          })
          .groups({
            space: true
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      // Only include mx and py to show shorthand expansion
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
      expect(result.css).toMatchSnapshot('shorthand-expansion-demo');
    });
  });
});
