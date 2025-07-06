import { describe, expect, it } from 'vitest';

import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { quantumGroups, quantumTheme } from './test-utils';

describe('Cascade Ordering Snapshots', () => {
  describe('Grouped Mode Cascade', () => {
    const generator = new CSSGenerator({ atomic: false });

    it('should cascade styles -> variants -> states', () => {
      const code = `
        const Button = animus
          .styles({
            color: 'black',
            padding: '8px',
          })
          .variant({
            prop: 'variant',
            variants: {
              primary: { color: 'blue', padding: '12px' },
              secondary: { color: 'gray' }
            }
          })
          .states({
            disabled: { color: 'gray', opacity: 0.5 }
          })
          .asElement('button');
      `;

      const components = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(
        components[0],
        quantumGroups,
        quantumTheme
      );

      expect(result.css).toMatchSnapshot();
    });

    it('should preserve responsive values in cascade', () => {
      const code = `
        const ResponsiveBox = animus
          .styles({
            padding: ['8px', '16px', '24px'],
            color: { _: 'black', sm: 'gray', md: 'white' }
          })
          .variant({
            prop: 'size',
            variants: {
              large: {
                padding: ['16px', '32px', '48px'],
                fontSize: ['18px', '24px']
              }
            }
          })
          .states({
            active: {
              color: { _: 'blue', lg: 'purple' }
            }
          })
          .asElement('div');
      `;

      const components = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(
        components[0],
        quantumGroups,
        quantumTheme
      );

      expect(result.css).toMatchSnapshot();
    });

    it('should cascade multiple variants in order', () => {
      const code = `
        const Card = animus
          .styles({})
          .variant({
            prop: 'size',
            variants: {
              small: { padding: '4px', fontSize: '12px' },
              large: { padding: '16px', fontSize: '18px' }
            }
          })
          .variant({
            prop: 'color',
            variants: {
              primary: { backgroundColor: 'blue', color: 'white' },
              secondary: { backgroundColor: 'gray' }
            }
          })
          .variant({
            prop: 'rounded',
            variants: {
              true: { borderRadius: '8px' },
              false: { borderRadius: '0' }
            }
          })
          .asElement('div');
      `;

      const components = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(
        components[0],
        quantumGroups,
        quantumTheme
      );

      expect(result.css).toMatchSnapshot();
    });

    it('should generate complex real-world component', () => {
      const code = `
        const ComplexButton = animus
          .styles({
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            userSelect: 'none',
            transition: 'all 0.2s',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
            }
          })
          .variant({
            prop: 'variant',
            variants: {
              primary: {
                backgroundColor: 'blue',
                color: 'white',
                '&:hover': {
                  backgroundColor: 'darkblue'
                }
              },
              secondary: {
                backgroundColor: 'transparent',
                color: 'blue',
                border: '2px solid blue',
                '&:hover': {
                  backgroundColor: 'blue',
                  color: 'white'
                }
              }
            }
          })
          .variant({
            prop: 'size',
            variants: {
              sm: { padding: '4px 8px', fontSize: '14px' },
              md: { padding: '8px 16px', fontSize: '16px' },
              lg: { padding: '12px 24px', fontSize: '18px' }
            }
          })
          .states({
            disabled: {
              opacity: 0.5,
              cursor: 'not-allowed',
              '&:hover': {
                transform: 'none',
                boxShadow: 'none'
              }
            },
            loading: {
              pointerEvents: 'none',
              '&::after': {
                content: '""',
                position: 'absolute',
                width: '16px',
                height: '16px',
                border: '2px solid currentColor',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.6s linear infinite'
              }
            }
          })
          .groups({ space: true })
          .props({
            rounded: {
              property: 'borderRadius',
              default: '4px'
            }
          })
          .asElement('button');
      `;

      const components = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(
        components[0],
        quantumGroups,
        quantumTheme
      );

      expect(result.css).toMatchSnapshot();
    });
  });

  describe('Component Styles (Always Grouped)', () => {
    it('should always generate grouped CSS for components', () => {
      const atomicGenerator = new CSSGenerator({ atomic: true });

      const code = `
        const AtomicComponent = animus
          .styles({
            padding: '16px',
            backgroundColor: 'gray'
          })
          .variant({
            prop: 'theme',
            variants: {
              dark: { backgroundColor: 'black', color: 'white' }
            }
          })
          .asElement('div');
      `;

      const components = extractStylesFromCode(code);
      const result = atomicGenerator.generateFromExtracted(
        components[0],
        quantumGroups,
        quantumTheme
      );

      // Component styles should be grouped even with atomic: true
      expect(result.css).toMatchSnapshot();
      expect(result.css).toContain('.animus-AtomicComponent');
      expect(result.css).not.toContain('.p-16');
      expect(result.css).not.toContain('.bg-gray');
    });
  });
});
