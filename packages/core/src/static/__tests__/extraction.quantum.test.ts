/**
 * Quantum Test Suite for Style Extraction
 *
 * In the quantum field of static analysis, we extract the essence
 * of components without ever executing them. Pure observation.
 */

import { describe, expect, it } from 'vitest';

import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { testGroups, testTheme } from './test-utils';

describe('[QUANTUM] Style Extraction: Observing Component Essence', () => {
  describe('Basic Style Extraction', () => {
    it('should extract base styles from quantum component', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px',
            borderRadius: '4px',
            backgroundColor: 'blue'
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);

      expect(extracted).toEqual([
        {
          componentName: 'Button',
          baseStyles: {
            padding: '8px 16px',
            borderRadius: '4px',
            backgroundColor: 'blue',
          },
        },
      ]);
    });

    it('should extract pseudo-selectors in quantum state', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px',
            '&:hover': {
              backgroundColor: 'darkblue'
            },
            '&:active': {
              transform: 'scale(0.98)'
            }
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);

      expect(extracted[0].baseStyles).toEqual({
        padding: '8px 16px',
        '&:hover': {
          backgroundColor: 'darkblue',
        },
        '&:active': {
          transform: 'scale(0.98)',
        },
      });
    });
  });

  describe('Variant Extraction', () => {
    it('should extract single variant dimension', () => {
      const code = `
        const Button = animus
          .styles({ padding: '8px 16px' })
          .variant({
            prop: 'size',
            variants: {
              small: { padding: '4px 8px', fontSize: '14px' },
              large: { padding: '12px 24px', fontSize: '18px' }
            }
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);

      expect(extracted[0].variants).toEqual({
        prop: 'size',
        variants: {
          small: { padding: '4px 8px', fontSize: '14px' },
          large: { padding: '12px 24px', fontSize: '18px' },
        },
      });
    });

    it('should extract multiple variant dimensions', () => {
      const code = `
        const Button = animus
          .styles({ padding: '8px 16px' })
          .variant({
            prop: 'size',
            variants: {
              small: { fontSize: '14px' },
              large: { fontSize: '18px' }
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

      expect(extracted[0].variants).toEqual([
        {
          prop: 'size',
          variants: {
            small: { fontSize: '14px' },
            large: { fontSize: '18px' },
          },
        },
        {
          prop: 'color',
          variants: {
            primary: { backgroundColor: 'blue', color: 'white' },
            secondary: { backgroundColor: 'gray', color: 'black' },
          },
        },
      ]);
    });
  });

  describe('State Extraction', () => {
    it('should extract boolean states', () => {
      const code = `
        const Button = animus
          .styles({ padding: '8px 16px' })
          .states({
            disabled: {
              opacity: 0.6,
              cursor: 'not-allowed'
            },
            loading: {
              position: 'relative',
              color: 'transparent'
            }
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);

      expect(extracted[0].states).toEqual({
        disabled: {
          opacity: 0.6,
          cursor: 'not-allowed',
        },
        loading: {
          position: 'relative',
          color: 'transparent',
        },
      });
    });
  });

  describe('Groups and Props Extraction', () => {
    it('should extract enabled groups', () => {
      const code = `
        const Box = animus
          .styles({ display: 'flex' })
          .groups({
            space: true,
            color: true,
            layout: true
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);

      expect(extracted[0].groups).toEqual(['space', 'color', 'layout']);
    });

    it('should extract custom props', () => {
      const code = `
        const Box = animus
          .styles({ display: 'block' })
          .props({
            bg: {
              property: 'backgroundColor',
              scale: 'colors'
            },
            size: {
              properties: ['width', 'height']
            }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);

      expect(extracted[0].props).toEqual({
        bg: {
          property: 'backgroundColor',
          scale: 'colors',
        },
        size: {
          properties: ['width', 'height'],
        },
      });
    });
  });

  describe('Responsive Values Extraction', () => {
    it('should extract object responsive syntax', () => {
      const code = `
        const Box = animus
          .styles({
            padding: { _: 10, sm: 20, lg: 40 },
            margin: { _: 0, md: 32 }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);

      expect(extracted[0].baseStyles).toEqual({
        padding: { _: 10, sm: 20, lg: 40 },
        margin: { _: 0, md: 32 },
      });
    });

    it('should extract array responsive syntax', () => {
      const code = `
        const Box = animus
          .styles({
            padding: [5, 10, 15, 20],
            margin: [0, undefined, 16]
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);

      expect(extracted[0].baseStyles).toEqual({
        padding: [5, 10, 15, 20],
        margin: [0, 16], // Sparse arrays lose empty slots during extraction
      });
    });
  });

  describe('CSS Generation Snapshots', () => {
    it('should generate CSS for complex component', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px',
            borderRadius: '4px',
            '&:hover': {
              backgroundColor: 'lightblue'
            }
          })
          .variant({
            prop: 'size',
            variants: {
              small: { padding: '4px 8px' },
              large: { padding: '12px 24px' }
            }
          })
          .states({
            disabled: { opacity: 0.6 }
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const generator = new CSSGenerator();
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });

    it('should generate CSS with responsive values', () => {
      const code = `
        const Box = animus
          .styles({
            padding: { _: 10, sm: 20, lg: 40 },
            margin: [0, 10, 20],
            backgroundColor: 'white'
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const generator = new CSSGenerator();
      const css = generator.generateFromExtracted(
        extracted[0],
        testGroups,
        testTheme
      );

      expect(css).toMatchSnapshot();
    });
  });
});
