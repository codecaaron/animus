import { describe, expect, it } from 'vitest';

import { extractStylesFromCode } from '../extractor';

describe('[QUANTUM] TypeScript Extractor - Pure Code Analysis', () => {
  describe('Basic Style Extraction', () => {
    it('should extract styles from simple component definition', () => {
      const code = `
        import { animus } from '@animus-ui/core';

        export const Button = animus
          .styles({
            padding: '8px 16px',
            backgroundColor: 'blue',
            color: 'white'
          })
          .asElement('button');
      `;

      const result = extractStylesFromCode(code);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        componentName: 'Button',
        baseStyles: {
          padding: '8px 16px',
          backgroundColor: 'blue',
          color: 'white',
        },
      });
    });

    it('should handle default exports', () => {
      const code = `
        import { animus } from '@animus-ui/core';

        const Card = animus
          .styles({
            padding: '16px',
            borderRadius: '8px'
          })
          .asElement('div');

        export default Card;
      `;

      const result = extractStylesFromCode(code);

      expect(result).toHaveLength(1);
      expect(result[0].componentName).toBe('Card');
      expect(result[0].baseStyles).toEqual({
        padding: '16px',
        borderRadius: '8px',
      });
    });

    it('should extract multiple components from single code string', () => {
      const code = `
        import { animus } from '@animus-ui/core';

        export const Button = animus
          .styles({ padding: '8px' })
          .asElement('button');

        export const Card = animus
          .styles({ borderRadius: '4px' })
          .asElement('div');

        export const Layout = animus
          .styles({ display: 'grid' })
          .asElement('div');
      `;

      const results = extractStylesFromCode(code);

      expect(results).toHaveLength(3);

      const componentNames = results.map((r) => r.componentName).sort();
      expect(componentNames).toEqual(['Button', 'Card', 'Layout']);
    });
  });

  describe('Variant Extraction', () => {
    it('should extract single variant definition with styles', () => {
      const code = `
        export const Button = animus
          .styles({ cursor: 'pointer' })
          .variant({
            prop: 'size',
            variants: {
              small: { padding: '4px 8px', fontSize: '12px' },
              medium: { padding: '8px 16px', fontSize: '14px' },
              large: { padding: '12px 24px', fontSize: '16px' }
            }
          })
          .asElement('button');
      `;

      const result = extractStylesFromCode(code);

      expect(result[0].variants).toBeDefined();
      expect(result[0].variants).toMatchObject({
        prop: 'size',
        variants: {
          small: { padding: '4px 8px', fontSize: '12px' },
          medium: { padding: '8px 16px', fontSize: '14px' },
          large: { padding: '12px 24px', fontSize: '16px' },
        },
      });
    });

    it('should extract multiple variant definitions', () => {
      const code = `
        export const Button = animus
          .styles({ cursor: 'pointer' })
          .variant({
            prop: 'size',
            variants: {
              small: { fontSize: '12px' },
              large: { fontSize: '18px' }
            }
          })
          .variant({
            prop: 'variant',
            variants: {
              primary: { backgroundColor: 'blue', color: 'white' },
              secondary: { backgroundColor: 'gray', color: 'black' }
            }
          })
          .asElement('button');
      `;

      const result = extractStylesFromCode(code);

      expect(result[0].variants).toHaveLength(2);
      const variants = result[0].variants as any[];
      expect(variants[0].prop).toBe('size');
      expect(variants[1].prop).toBe('variant');
    });
  });

  describe('State Extraction', () => {
    it('should extract boolean states with styles', () => {
      const code = `
        export const Button = animus
          .styles({ cursor: 'pointer' })
          .states({
            disabled: { opacity: 0.6, cursor: 'not-allowed' },
            loading: { position: 'relative', color: 'transparent' },
            active: { transform: 'scale(0.98)' }
          })
          .asElement('button');
      `;

      const result = extractStylesFromCode(code);

      expect(result[0].states).toMatchObject({
        disabled: { opacity: 0.6, cursor: 'not-allowed' },
        loading: { position: 'relative', color: 'transparent' },
        active: { transform: 'scale(0.98)' },
      });
    });

    it('should handle states with pseudo-selectors', () => {
      const code = `
        export const Card = animus
          .styles({ transition: 'all 0.2s' })
          .states({
            interactive: {
              cursor: 'pointer',
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
              },
              '&:active': {
                transform: 'translateY(0)'
              }
            }
          })
          .asElement('div');
      `;

      const result = extractStylesFromCode(code);

      expect(result[0].states!.interactive).toBeDefined();
      expect(result[0].states!.interactive['&:hover']).toMatchObject({
        transform: 'translateY(-2px)',
        boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
      });
    });
  });

  describe('Group and Props Extraction', () => {
    it('should extract enabled groups with styles', () => {
      const code = `
        export const Box = animus
          .styles({ display: 'block' })
          .groups({ 
            space: true, 
            color: true,
            layout: true 
          })
          .asElement('div');
      `;

      const result = extractStylesFromCode(code);

      expect(result[0].groups).toEqual(['space', 'color', 'layout']);
    });

    it('should extract custom props with styles', () => {
      const code = `
        export const Box = animus
          .styles({ display: 'block' })
          .props({
            bg: {
              property: 'backgroundColor',
              scale: 'colors'
            },
            bgGradient: {
              property: 'backgroundImage',
              scale: 'gradients',
              transform: v => \`linear-gradient(\${v})\`
            }
          })
          .asElement('div');
      `;

      const result = extractStylesFromCode(code);

      expect(result[0].props).toMatchObject({
        bg: {
          property: 'backgroundColor',
          scale: 'colors',
        },
        bgGradient: {
          property: 'backgroundImage',
          scale: 'gradients',
        },
      });
    });
  });

  describe('Complex Component Chains', () => {
    it('should extract complete component definition', () => {
      const code = `
        export const Button = animus
          .styles({
            padding: '8px 16px',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'all 0.2s'
          })
          .variant({
            prop: 'size',
            variants: {
              small: { padding: '4px 8px', fontSize: '12px' },
              large: { padding: '12px 24px', fontSize: '18px' }
            }
          })
          .variant({
            prop: 'variant',
            variants: {
              primary: { backgroundColor: 'blue', color: 'white' },
              ghost: { backgroundColor: 'transparent', border: '1px solid' }
            }
          })
          .states({
            disabled: { opacity: 0.6, cursor: 'not-allowed' },
            loading: { position: 'relative' }
          })
          .groups({ space: true, color: true })
          .props({
            elevation: {
              property: 'boxShadow',
              scale: 'shadows'
            }
          })
          .asElement('button');
      `;

      const result = extractStylesFromCode(code);

      expect(result[0]).toMatchObject({
        componentName: 'Button',
        baseStyles: expect.objectContaining({
          padding: '8px 16px',
          borderRadius: '4px',
        }),
        variants: expect.arrayContaining([
          expect.objectContaining({ prop: 'size' }),
          expect.objectContaining({ prop: 'variant' }),
        ]),
        states: expect.objectContaining({
          disabled: expect.any(Object),
          loading: expect.any(Object),
        }),
        groups: ['space', 'color'],
        props: expect.objectContaining({
          elevation: expect.any(Object),
        }),
      });
    });

    it('should handle component extension', () => {
      const code = `
        const BaseButton = animus
          .styles({ padding: '8px 16px' })
          .asElement('button');

        export const PrimaryButton = BaseButton.extend()
          .styles({ backgroundColor: 'blue', color: 'white' })
          .states({ active: { backgroundColor: 'darkblue' } })
          .asElement('button');
      `;

      const result = extractStylesFromCode(code);

      // Should extract both components
      expect(result).toHaveLength(2);

      const base = result.find((r) => r.componentName === 'BaseButton');
      const primary = result.find((r) => r.componentName === 'PrimaryButton');

      expect(base?.baseStyles).toMatchObject({ padding: '8px 16px' });
      expect(primary?.baseStyles).toMatchObject({
        backgroundColor: 'blue',
        color: 'white',
      });
    });
  });

  describe('Export Pattern Handling', () => {
    it('should handle various export patterns', () => {
      const code = `
        import { animus } from '@animus-ui/core';

        // Named export directly
        export const Button = animus.styles({ padding: '8px' }).asElement('button');

        // Variable then export
        const Card = animus.styles({ border: '1px solid' }).asElement('div');
        export { Card };

        // Export with rename
        const InternalLayout = animus.styles({ display: 'grid' }).asElement('div');
        export { InternalLayout as Layout };

        // Multiple exports in one statement
        const Header = animus.styles({ height: '60px' }).asElement('header');
        const Footer = animus.styles({ padding: '20px' }).asElement('footer');
        export { Header, Footer };
      `;

      const results = extractStylesFromCode(code);

      // Should find all components regardless of export style
      expect(results.length).toBeGreaterThanOrEqual(5);

      const names = results.map((r) => r.componentName).sort();
      expect(names).toContain('Button');
      expect(names).toContain('Card');
      expect(names).toContain('InternalLayout'); // Original name, not export alias
      expect(names).toContain('Header');
      expect(names).toContain('Footer');
    });

    it('should handle arrow function components', () => {
      const code = `
        export const Button = animus
          .styles({ padding: '8px' })
          .asComponent((props) => {
            return <button {...props} />;
          });

        export const Card = animus
          .styles({ border: '1px solid' })
          .asComponent((props) => (
            <div {...props} className={\`card \${props.className || ''}\`} />
          ));
      `;

      const results = extractStylesFromCode(code);

      expect(results).toHaveLength(2);
      expect(results[0].componentName).toBe('Button');
      expect(results[1].componentName).toBe('Card');
    });
  });

  describe('Component File Detection', () => {
    it('should identify code containing animus components with styles', () => {
      const componentCode = `
        import { animus } from '@animus-ui/core';
        export const Button = animus.styles({}).asElement('button');
      `;

      const result = extractStylesFromCode(componentCode);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should NOT detect components without .styles() - known limitation', () => {
      // ⚠️ ARCHITECTURAL ISSUE: Components without .styles() are not detected
      // This is documented in QUANTUM_TEST_HANDOFF.md
      const componentCode = `
        import { animus } from '@animus-ui/core';
        export const UtilityBox = animus.groups({ space: true }).asElement('div');
      `;
      const result = extractStylesFromCode(componentCode);
      expect(result.length).toBe(0); // Currently fails to detect
    });

    it('should return empty array for non-animus code', () => {
      const utilCode = `
        export function helper() { return 42; }
      `;

      const result = extractStylesFromCode(utilCode);
      expect(result).toHaveLength(0);
    });

    it('should NOT detect components with just variants - known limitation', () => {
      // ⚠️ ARCHITECTURAL ISSUE: Components without .styles() are not detected
      const variantOnlyCode = `
        import { animus } from '@animus-ui/core';
        export const Card = animus.variant({ prop: 'size' }).asElement('div');
      `;

      const result = extractStylesFromCode(variantOnlyCode);
      expect(result.length).toBe(0); // Currently fails to detect
    });

    it('should detect components across mixed content', () => {
      const mixedCode = `
        import { animus } from '@animus-ui/core';
        import { utils } from './utils';

        // Regular function
        function doSomething() { return 'hello'; }

        // Animus component
        export const Button = animus.styles({ padding: '8px' }).asElement('button');

        // Another regular export
        export const config = { theme: 'dark' };

        // Another animus component
        export const Card = animus.styles({ border: '1px solid' }).asElement('div');
      `;

      const results = extractStylesFromCode(mixedCode);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.componentName).sort()).toEqual([
        'Button',
        'Card',
      ]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty style objects', () => {
      const code = `
        export const Minimal = animus
          .styles({})
          .asElement('div');
      `;

      const result = extractStylesFromCode(code);
      expect(result[0].baseStyles).toEqual({});
    });

    it('should NOT detect components with only variants - known limitation', () => {
      // ⚠️ ARCHITECTURAL ISSUE: Components without .styles() are not detected
      const code = `
        export const VariantOnly = animus
          .variant({
            prop: 'type',
            variants: {
              info: { backgroundColor: 'blue' },
              error: { backgroundColor: 'red' }
            }
          })
          .asElement('div');
      `;

      const result = extractStylesFromCode(code);
      expect(result).toHaveLength(0); // Currently fails to detect
      
      // TODO: Fix extractor to detect components without .styles()
    });

    it('should handle nested object styles', () => {
      const code = `
        export const Complex = animus
          .styles({
            padding: '16px',
            '&:hover': {
              backgroundColor: 'gray',
              transform: 'scale(1.05)'
            },
            '& > span': {
              fontSize: '14px',
              color: 'inherit'
            }
          })
          .asElement('div');
      `;

      const result = extractStylesFromCode(code);
      expect(result[0].baseStyles).toMatchObject({
        padding: '16px',
        '&:hover': {
          backgroundColor: 'gray',
          transform: 'scale(1.05)',
        },
        '& > span': {
          fontSize: '14px',
          color: 'inherit',
        },
      });
    });

    it('should ignore non-animus components', () => {
      const code = `
        import { animus } from '@animus-ui/core';
        import React from 'react';

        // Regular React component - should be ignored
        export const RegularComponent = () => <div>Hello</div>;

        // Styled-components style - should be ignored
        const StyledButton = styled.button\`
          padding: 8px;
        \`;

        // Animus component - should be extracted
        export const AnimusButton = animus
          .styles({ padding: '8px' })
          .asElement('button');

        // Regular function - should be ignored
        export function helper() {
          return 42;
        }
      `;

      const results = extractStylesFromCode(code);

      expect(results).toHaveLength(1);
      expect(results[0].componentName).toBe('AnimusButton');
    });
  });
});
