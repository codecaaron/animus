import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import {
  minimalColor,
  minimalSpace,
  minimalTypography,
  testTheme,
} from './testConfig';

describe('Real Component Patterns', () => {
  let generator: CSSGenerator;

  beforeEach(() => {
    generator = new CSSGenerator();
  });

  describe('Component Extraction', () => {
    it('extracts Logo component with complex styles', () => {
      const logoCode = `
        import { animus } from '@animus-ui/core';
        import { flow } from '../../animations/flow';

        export const Logo = animus
          .styles({
            width: 'max-content',
            fontSize: 30,
            m: 0,
            lineHeight: 'initial',
            fontFamily: 'logo',
            letterSpacing: '2px',
            gradient: 'flowX',
            backgroundSize: '300px 100px',
            animation: \` \${flow} 5s linear infinite\`,
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: 'logo',
            transition: 'text',
          })
          .states({
            link: {
              animation: 'none',
              '&:hover': {
                textShadow: 'logo-hover',
                animation: \` \${flow} 5s linear infinite\`,
              },
              '&:active': {
                textShadow: 'link-pressed',
              },
            },
          })
          .groups({ typography: true })
          .props({
            logoSize: {
              property: 'fontSize',
              scale: { xs: 28, sm: 32, md: 64, lg: 72, xl: 96, xxl: 128 },
            },
          })
          .asElement('h1');
      `;

      const extracted = extractStylesFromCode(logoCode);

      // Assert extraction structure instead of snapshot
      expect(extracted).toHaveLength(1);
      const logoStyle = extracted[0];

      // Verify component name
      expect(logoStyle.componentName).toBe('Logo');

      // Verify base styles
      expect(logoStyle.baseStyles).toEqual({
        width: 'max-content',
        fontSize: 30,
        m: 0,
        lineHeight: 'initial',
        fontFamily: 'logo',
        letterSpacing: '2px',
        gradient: 'flowX',
        backgroundSize: '300px 100px',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        textShadow: 'logo',
        transition: 'text',
      });

      // Verify states
      expect(logoStyle.states).toEqual({
        link: {
          animation: 'none',
          '&:hover': {
            textShadow: 'logo-hover',
          },
          '&:active': {
            textShadow: 'link-pressed',
          },
        },
      });

      // Verify groups
      expect(logoStyle.groups).toEqual(['typography']);

      // Verify props
      expect(logoStyle.props).toEqual({
        logoSize: {
          property: 'fontSize',
          scale: { xs: 28, sm: 32, md: 64, lg: 72, xl: 96, xxl: 128 },
        },
      });
    });

    it('extracts component with responsive values', () => {
      const code = `
        const HeaderSection = animus
          .styles({
            display: 'grid',
            gap: { _: 24, sm: 32 },
            flow: 'column',
            alignItems: 'center',
            flex: 1,
          })
          .variant({
            prop: 'direction',
            variants: {
              left: {},
              right: {
                justifyContent: 'end',
              },
            },
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);

      // Assert extraction structure instead of snapshot
      expect(extracted).toHaveLength(1);
      const headerStyle = extracted[0];

      // Verify component name
      expect(headerStyle.componentName).toBe('HeaderSection');

      // Verify base styles with responsive values
      expect(headerStyle.baseStyles).toEqual({
        display: 'grid',
        gap: { _: 24, sm: 32 },
        flow: 'column',
        alignItems: 'center',
        flex: 1,
      });

      // Verify variant structure
      expect(headerStyle.variants).toEqual({
        prop: 'direction',
        variants: {
          left: {},
          right: {
            justifyContent: 'end',
          },
        },
      });
    });
  });

  describe('CSS Generation', () => {
    it('generates CSS for component with all features', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px',
            backgroundColor: 'blue',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            '&:hover': {
              backgroundColor: 'darkblue',
            },
          })
          .variant({
            prop: 'variant',
            variants: {
              primary: {
                backgroundColor: 'darkblue',
              },
              secondary: {
                backgroundColor: 'gray',
                color: 'black',
              },
            },
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
      expect(result.css).toMatchSnapshot('full-featured-component-css');
    });

    it('generates CSS with proper cascade ordering', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px',
            backgroundColor: 'blue',
          })
          .variant({
            prop: 'size',
            variants: {
              small: { padding: '4px 8px' },
              large: { padding: '12px 24px' },
            },
          })
          .variant({
            prop: 'variant',
            variants: {
              primary: { backgroundColor: 'darkblue' },
              secondary: { backgroundColor: 'gray' },
            },
          })
          .states({
            disabled: { opacity: 0.5 },
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0]);
      expect(result.css).toMatchSnapshot('cascade-ordering-css');
    });
  });

  describe('Atomic Utilities Generation', () => {
    it('generates minimal atomic utilities for space group', () => {
      const code = `
        const Box = animus
          .styles({
            display: 'flex',
            backgroundColor: 'white',
          })
          .groups({
            space: true,
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(
        extracted[0],
        { space: minimalSpace },
        testTheme
      );
      expect(result.css).toMatchSnapshot('minimal-space-utilities');
    });

    it('generates atomic utilities for multiple groups', () => {
      const code = `
        const Card = animus
          .styles({
            borderRadius: 8,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          })
          .groups({
            space: true,
            color: true,
            typography: true,
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const groupDefs = {
        space: minimalSpace,
        color: minimalColor,
        typography: minimalTypography,
      };
      const result = generator.generateFromExtracted(
        extracted[0],
        groupDefs,
        testTheme
      );
      expect(result.css).toMatchSnapshot('minimal-multiple-groups');
    });

    it('generates atomic utilities for custom props', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px',
            border: 'none',
            cursor: 'pointer',
          })
          .props({
            size: {
              property: 'fontSize',
              scale: 'fontSizes',
            },
            gap: {
              property: 'gap',
              scale: 'space',
            },
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(
        extracted[0],
        {},
        testTheme
      );
      expect(result.css).toMatchSnapshot('minimal-custom-props');
    });

    it('demonstrates shorthand expansion in atomic utilities', () => {
      const code = `
        const Container = animus
          .styles({
            display: 'grid',
          })
          .groups({
            space: true,
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      // Only include mx and py to show expansion clearly
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

    it('places atomic utilities after component styles', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px',
            backgroundColor: 'blue',
            color: 'white',
          })
          .variant({
            prop: 'variant',
            variants: {
              primary: {
                backgroundColor: 'darkblue',
              },
            },
          })
          .states({
            disabled: {
              opacity: 0.5,
            },
          })
          .groups({
            space: true,
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(
        extracted[0],
        { space: minimalSpace },
        testTheme
      );
      expect(result.css).toMatchSnapshot('cascade-with-utilities');
    });
  });

  describe('Theme Integration', () => {
    it('uses theme values for utilities generation', () => {
      const customTheme = {
        space: {
          xs: '0.25rem',
          sm: '0.5rem',
          md: '1rem',
        },
        colors: {
          brand: '#007bff',
          accent: '#6c757d',
        },
        fontSizes: {
          body: '16px',
          heading: '24px',
        },
      };

      const code = `
        const ThemedComponent = animus
          .styles({
            padding: '1rem',
          })
          .groups({
            space: true,
            color: true,
            typography: true,
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const groupDefs = {
        space: minimalSpace,
        color: minimalColor,
        typography: minimalTypography,
      };
      const result = generator.generateFromExtracted(
        extracted[0],
        groupDefs,
        customTheme
      );
      expect(result.css).toMatchSnapshot('custom-theme-utilities');
    });
  });
});
