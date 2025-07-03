import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';

import { ComponentRegistry } from '../component-registry';
import type { ComponentEntry } from '../component-registry';
import type { ExtractedStylesWithIdentity } from '../component-identity';

describe('CSS Cascade Ordering Snapshots', () => {
  describe('Grouped Mode Cascade', () => {
    const generator = new CSSGenerator({ atomic: false });

    it('should order styles, variants, and states correctly', () => {
      const code = `
        const Button = animus
          .styles({
            padding: 16,
            bg: 'gray',
            '&:hover': {
              bg: 'darkgray',
            }
          })
          .variant({
            prop: 'size',
            variants: {
              small: { padding: 8 },
              large: { padding: 24 },
            }
          })
          .variant({
            prop: 'color',
            variants: {
              primary: { bg: 'blue', color: 'white' },
              danger: { bg: 'red', color: 'white' },
            }
          })
          .states({
            disabled: { opacity: 0.5, cursor: 'not-allowed' },
            loading: { cursor: 'wait' },
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);

      expect(result.css).toMatchSnapshot();
    });

    it('should handle responsive values within each cascade level', () => {
      const code = `
        const Card = animus
          .styles({
            padding: { _: 16, sm: 24, lg: 32 },
            display: 'block',
          })
          .variant({
            prop: 'layout',
            variants: {
              horizontal: {
                display: 'flex',
                gap: { _: 12, md: 20 },
              }
            }
          })
          .states({
            expanded: {
              padding: { _: 24, sm: 32, lg: 48 },
            }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);

      expect(result.css).toMatchSnapshot();
    });

    it('should maintain variant order from builder chain', () => {
      const code = `
        const Component = animus
          .styles({ color: 'black' })
          .variant({
            prop: 'tone',
            variants: {
              light: { bg: 'white' },
              dark: { bg: 'black' },
            }
          })
          .variant({
            prop: 'tone',  // Same prop, different values - should cascade
            variants: {
              light: { borderColor: 'gray' },
              dark: { borderColor: 'white' },
            }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);

      expect(result.css).toMatchSnapshot();
    });

    it('should handle complex real-world component with all features', () => {
      const code = `
        const ArticleCard = animus
          .styles({
            // Responsive spacing
            p: { _: 16, sm: 24, lg: 32 },
            m: [0, 8, 16, 24],
            
            // Layout
            display: 'flex',
            flexDirection: { _: 'column', md: 'row' },
            gap: { _: 16, sm: 24 },
            
            // Styling
            bg: 'white',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            
            // Responsive sizing
            maxWidth: { _: '100%', sm: 640, lg: 960 },
            mx: 'auto',
            
            // Hover state
            '&:hover': {
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              transform: 'translateY(-2px)',
            }
          })
          .variant({
            prop: 'size',
            variants: {
              compact: {
                p: { _: 12, sm: 16 },
                gap: 12,
              },
              spacious: {
                p: { _: 24, sm: 32, lg: 48 },
                gap: { _: 24, md: 32 },
              }
            }
          })
          .variant({
            prop: 'theme',
            variants: {
              light: {
                bg: 'white',
                color: 'black',
                borderWidth: 1,
                borderColor: 'gray.200',
              },
              dark: {
                bg: 'gray.900',
                color: 'white',
                borderWidth: 1,
                borderColor: 'gray.700',
              }
            }
          })
          .states({
            featured: {
              borderWidth: 2,
              borderColor: 'primary',
              p: { _: 24, sm: 32, lg: 40 },
              '&::before': {
                content: '""',
                position: 'absolute',
                inset: 0,
                bg: 'primary',
                opacity: 0.1,
              }
            },
            disabled: {
              opacity: 0.5,
              cursor: 'not-allowed',
              '&:hover': {
                transform: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              }
            }
          })
          .groups({
            space: true,
            color: true,
          })
          .props({
            elevation: {
              property: 'boxShadow',
              scale: {
                low: '0 1px 3px rgba(0,0,0,0.1)',
                medium: '0 4px 6px rgba(0,0,0,0.1)',
                high: '0 10px 20px rgba(0,0,0,0.1)',
              }
            }
          })
          .asElement('article');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);

      expect(result.css).toMatchSnapshot();
    });
  });

  describe('Component Styles (Always Grouped)', () => {
    const generator = new CSSGenerator({ atomic: true }); // atomic flag is ignored for component styles

    it('should generate grouped styles even when atomic flag is set', () => {
      const code = `
        const Button = animus
          .styles({
            padding: { _: 16, sm: 24 },
            margin: 0,
            bg: 'blue',
            '&:hover': {
              bg: 'darkblue',
            }
          })
          .variant({
            prop: 'size',
            variants: {
              small: { padding: 8, fontSize: 14 },
              large: { padding: 32, fontSize: 20 },
            }
          })
          .states({
            disabled: { 
              opacity: 0.5,
              cursor: 'not-allowed',
            },
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);

      expect(result.css).toMatchSnapshot();
    });
  });
});
