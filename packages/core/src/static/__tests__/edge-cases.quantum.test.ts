import { describe, expect, it } from 'vitest';

import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { buildUsageMap, extractComponentUsage } from '../usageCollector';
import { testGroups as groupDefinitions, testTheme } from './test-utils';

/**
 * QUANTUM TEST: Edge Cases and Complex Patterns
 *
 * This test suite covers complex patterns and edge cases in component
 * extraction and CSS generation using string-based testing.
 */

describe('[QUANTUM] Edge Cases and Complex Patterns', () => {
  const generator = new CSSGenerator();

  describe('Complex Variant Patterns', () => {
    it('should handle multiple variant calls with nested selectors', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px',
            cursor: 'pointer',
            '&:hover': {
              transform: 'translateY(-2px)',
            }
          })
          .variant({
            prop: 'size',
            variants: {
              sm: {
                padding: '4px 8px',
                fontSize: '14px',
                '&:hover': {
                  transform: 'translateY(-1px)',
                }
              },
              lg: {
                padding: '12px 24px',
                fontSize: '18px',
                '&:hover': {
                  transform: 'translateY(-3px)',
                }
              }
            }
          })
          .variant({
            prop: 'variant',
            variants: {
              primary: {
                backgroundColor: 'blue',
                color: 'white',
                '&:hover': {
                  backgroundColor: 'darkblue',
                },
                '&:active': {
                  backgroundColor: 'navy',
                }
              },
              secondary: {
                backgroundColor: 'gray',
                color: 'black',
                '&:hover': {
                  backgroundColor: 'darkgray',
                },
                '&:disabled': {
                  opacity: 0.5,
                  cursor: 'not-allowed',
                }
              }
            }
          })
          .states({
            loading: {
              position: 'relative',
              color: 'transparent',
              '&::after': {
                content: '""',
                position: 'absolute',
                width: '16px',
                height: '16px',
                border: '2px solid',
                borderRadius: '50%',
                borderTopColor: 'transparent',
                animation: 'spin 0.6s linear infinite',
              }
            }
          })
          .groups({ space: true, color: true })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      expect(extracted).toHaveLength(1);
      expect(extracted[0].variants).toHaveLength(2);

      // Test usage with multiple active variants
      const usageCode = `
        <Button size="lg" variant="primary" loading p={4} color="secondary">
          Click me
        </Button>
      `;

      const usages = extractComponentUsage(usageCode);
      const usageMap = buildUsageMap(usages);

      const result = generator.generateFromExtracted(
        extracted[0],
        groupDefinitions,
        testTheme,
        usageMap
      );

      // Should include both size and variant styles
      expect(result.css).toContain('padding: 12px 24px'); // lg size
      expect(result.css).toContain('background-color: blue'); // primary variant
      expect(result.css).toContain(':hover'); // nested selectors (without &)
      expect(result.css).toContain('animation: spin'); // loading state
    });
  });

  describe('Spread Props Handling', () => {
    it('documents current limitation with spread props', () => {
      const code = `
        const Card = animus
          .styles({ padding: '16px', borderRadius: '8px' })
          .groups({ space: true })
          .asElement('div');
      `;

      const usageCode = `
        const props = { p: 2, m: 3 };
        const moreProps = { p: 4 };

        export const Test = () => (
          <>
            <Card {...props} m={2}>Content</Card>
            <Card {...moreProps} {...props}>Override</Card>
            <Card p={1} {...props}>Overridden</Card>
          </>
        );
      `;

      extractStylesFromCode(code);
      const usages = extractComponentUsage(usageCode);

      // Current implementation doesn't handle spread props
      // This test documents the limitation
      expect(usages[0].props).toEqual({ m: 2 }); // Only captures explicit props

      // TODO: Implement spread prop handling
      // This is a known limitation documented in QUANTUM_TEST_HANDOFF.md
    });
  });

  describe('Cross-File Complex Patterns', () => {
    it('should handle compound components with cross-file usage', () => {
      // This test documents the need for proper compound component tracking
      // The registry should track Layout.Header as a separate component
      // but maintain its relationship to Layout

      const layoutCode = `
        const LayoutContainer = animus
          .styles({
            display: 'grid',
            gridTemplateAreas: '"header header" "sidebar content"',
          })
          .states({
            collapsed: {
              gridTemplateAreas: '"header header" "content content"',
            }
          })
          .asElement('div');

        const Header = animus
          .styles({ gridArea: 'header' })
          .asElement('header');

        export const Layout = LayoutContainer;
        Layout.Header = Header;
      `;

      const appCode = `
        import { Layout } from './Layout';

        export const App = () => (
          <Layout collapsed>
            <Layout.Header>Title</Layout.Header>
          </Layout>
        );
      `;

      // Extract components from layout code
      const layoutComponents = extractStylesFromCode(layoutCode);
      const appUsage = extractComponentUsage(appCode);

      // Verify we can extract compound components
      expect(layoutComponents).toHaveLength(2);
      expect(layoutComponents[0].componentName).toBe('LayoutContainer');
      expect(layoutComponents[1].componentName).toBe('Header');

      // Document that compound usage tracking needs implementation
      expect(appUsage).toHaveLength(2);
      // TODO: Implement tracking of Layout.Header as compound component
    });
  });

  describe('Performance Edge Cases', () => {
    it('should handle components with many variants efficiently', () => {
      const variantCount = 20;
      const variants: any = {};

      for (let i = 0; i < variantCount; i++) {
        variants[`variant${i}`] = {
          backgroundColor: `color${i}`,
          padding: `${i * 4}px`,
        };
      }

      const code = `
        const MegaButton = animus
          .styles({ cursor: 'pointer' })
          .variant({
            prop: 'type',
            variants: ${JSON.stringify(variants)}
          })
          .asElement('button');
      `;

      const startTime = Date.now();
      const extracted = extractStylesFromCode(code);
      const extractTime = Date.now() - startTime;

      expect(extracted[0].variants).toBeDefined();
      expect(extractTime).toBeLessThan(100); // Should be fast even with many variants
    });
  });

  describe('Responsive Array Edge Cases', () => {
    it('documents limitation with sparse arrays being compacted by AST parser', () => {
      const code = `
        const Box = animus.groups({ space: true }).asElement('div');
      `;

      const usageCode = `
        export const Test = () => (
          <>
            <Box p={[1, undefined, 3, undefined, 5]}>Sparse array</Box>
            <Box m={[0, undefined, 2, null, 4]}>Mixed nullish</Box>
          </>
        );
      `;

      extractStylesFromCode(code);
      const usages = extractComponentUsage(usageCode);
      const usageMap = buildUsageMap(usages);

      // LIMITATION: Babel's AST parser compacts arrays with undefined values
      // [1, undefined, 3, undefined, 5] becomes [1, 3, 5]
      // This loses the positional information needed for correct breakpoint mapping

      expect(usageMap.Box.p).toBeDefined();
      const pValues = Array.from(usageMap.Box.p);

      // What we get (compacted array):
      expect(pValues).toContain('1:_'); // Index 0 -> _
      expect(pValues).toContain('3:xs'); // Index 1 -> xs (WRONG - should be sm)
      expect(pValues).toContain('5:sm'); // Index 2 -> sm (WRONG - should be lg)

      // TODO: To fix this, we'd need to preserve array holes in the AST parser
      // or use a different approach for responsive values
      // This is documented in QUANTUM_TEST_HANDOFF.md as a known issue
    });
  });

  describe('Theme Token Resolution', () => {
    it('should handle nested theme tokens and CSS variables', () => {
      const code = `
        const ThemedCard = animus
          .styles({
            backgroundColor: 'colors.surface.primary',
            color: 'colors.text.primary',
            boxShadow: 'shadows.elevation.1',
          })
          .variant({
            prop: 'elevation',
            variants: {
              raised: {
                boxShadow: 'shadows.elevation.2',
                '&:hover': {
                  boxShadow: 'shadows.elevation.3',
                }
              }
            }
          })
          .asElement('div');
      `;

      const themeWithNested = {
        colors: {
          surface: { primary: '#ffffff' },
          text: { primary: '#212529' },
        },
        shadows: {
          elevation: {
            1: '0 1px 3px rgba(0,0,0,0.12)',
            2: '0 3px 6px rgba(0,0,0,0.16)',
            3: '0 10px 20px rgba(0,0,0,0.19)',
          },
        },
      };

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(
        extracted[0],
        {},
        themeWithNested,
        {}
      );

      // With theme resolution, nested paths should be resolved
      expect(result.css).toContain(
        'background-color: var(--animus-colors-surface-primary)'
      );
      expect(result.css).toContain('color: var(--animus-colors-text-primary)');
      expect(result.css).toContain(
        'box-shadow: var(--animus-shadows-elevation-2)'
      );

      // Should generate CSS variables
      expect(result.cssVariables).toContain(
        '--animus-colors-surface-primary: #ffffff'
      );
      expect(result.cssVariables).toContain(
        '--animus-colors-text-primary: #212529'
      );
    });
  });

  describe('Inheritance Chain Edge Cases', () => {
    it('should handle deep extension chains', () => {
      const code = `
        const Base = animus
          .styles({ padding: '8px' })
          .asElement('button');

        const Primary = Base.extend()
          .styles({ backgroundColor: 'blue' })
          .asElement('button');

        const PrimaryLarge = Primary.extend()
          .styles({ padding: '16px' })
          .variant({
            prop: 'rounded',
            variants: {
              full: { borderRadius: '9999px' }
            }
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);

      // Should extract all three components
      expect(extracted).toHaveLength(3);
      expect(extracted[0].componentName).toBe('Base');
      expect(extracted[1].componentName).toBe('Primary');
      expect(extracted[2].componentName).toBe('PrimaryLarge');

      // PrimaryLarge should have its own styles plus variant
      expect(extracted[2].baseStyles).toEqual({ padding: '16px' });
      expect(extracted[2].variants).toBeDefined();
    });
  });

  describe('Complex Selector Patterns', () => {
    it('should handle complex pseudo-selectors and combinators', () => {
      const code = `
        const ComplexCard = animus
          .styles({
            position: 'relative',
            padding: '20px',
            '&:hover': {
              backgroundColor: 'lightgray',
            },
            '&:hover > .title': {
              color: 'blue',
            },
            '&:nth-child(2n)': {
              backgroundColor: 'rgba(0, 0, 0, 0.05)',
            },
            '&[data-active="true"]': {
              borderColor: 'blue',
            },
            '& + &': {
              marginTop: '10px',
            },
            '&:not(:last-child)': {
              borderBottom: '1px solid #eee',
            }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(extracted[0], {}, {}, {});

      // Verify complex selectors are preserved
      expect(result.css).toContain(':hover');
      expect(result.css).toContain(':hover > .title');
      expect(result.css).toContain(':nth-child(2n)');
      expect(result.css).toContain('[data-active="true"]');
      expect(result.css).toContain('+'); // Adjacent sibling
      expect(result.css).toContain(':not(:last-child)');
    });
  });

  describe('Component Detection Edge Cases', () => {
    it('documents the limitation that components must have .styles()', () => {
      // This is a known limitation documented in QUANTUM_TEST_HANDOFF.md
      const code = `
        // This component won't be detected:
        const UtilityBox = animus
          .groups({ space: true, color: true })
          .asElement('div');

        // This component will be detected:
        const DetectableBox = animus
          .styles({}) // Empty styles for detection
          .groups({ space: true, color: true })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);

      // Only DetectableBox is found
      expect(extracted).toHaveLength(1);
      expect(extracted[0].componentName).toBe('DetectableBox');

      // TODO: Fix extractor to detect components without .styles()
      // Tracked as issue #8 in todos
    });
  });

  describe('Custom Props with Complex Transforms', () => {
    it('should handle custom props with transform functions', () => {
      const code = `
        const GradientBox = animus
          .styles({
            position: 'relative',
          })
          .props({
            gradientAngle: {
              property: 'background',
              transform: (value) => \`linear-gradient(\${value}deg, #ff0000, #00ff00)\`,
            },
            blur: {
              property: 'filter',
              transform: (value) => \`blur(\${value}px)\`,
            },
            grid: {
              properties: ['gridTemplateColumns', 'gridTemplateRows'],
              transform: (value) => \`repeat(\${value}, 1fr)\`,
            }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);

      expect(extracted[0].props).toBeDefined();
      expect(extracted[0].props!.gradientAngle).toMatchObject({
        property: 'background',
      });
      expect(extracted[0].props!.blur).toMatchObject({
        property: 'filter',
      });
      expect(extracted[0].props!.grid).toMatchObject({
        properties: ['gridTemplateColumns', 'gridTemplateRows'],
      });
    });
  });
});
