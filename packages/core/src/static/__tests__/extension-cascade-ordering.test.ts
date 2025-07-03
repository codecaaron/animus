import exp from 'constants';

import * as ts from 'typescript';

import type { ExtractedStylesWithIdentity } from '../component-identity';
import { createComponentIdentity } from '../component-identity';
import type { ComponentEntry } from '../component-registry';
import { ComponentRegistry } from '../component-registry';
import { CSSGenerator } from '../generator';
import type { UsageMap } from '../types';

describe('Extension Cascade Ordering', () => {
  let program: ts.Program;
  let registry: ComponentRegistry;
  let generator: CSSGenerator;

  const createProgram = (files: string[]): ts.Program => {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    };
    return ts.createProgram(files, options);
  };

  beforeEach(() => {
    program = createProgram(['test.ts']);
    registry = new ComponentRegistry(program);
    generator = new CSSGenerator({ prefix: 'animus' });
  });

  it('children components come after parents in CSS output', async () => {
    // Create parent component
    const parentIdentity = createComponentIdentity(
      'Button',
      '/test/Button.ts',
      'default'
    );

    // Create child component that extends parent
    const childIdentity = createComponentIdentity(
      'PrimaryButton',
      '/test/PrimaryButton.ts',
      'default'
    );

    // Parent component styles
    const parentStyles: ExtractedStylesWithIdentity = {
      identity: parentIdentity,
      componentName: 'Button',
      baseStyles: {
        padding: '8px 16px',
        borderRadius: '4px',
        backgroundColor: 'white',
      },
      variants: [
        {
          prop: 'size',
          variants: {
            small: { padding: '4px 8px' },
            large: { padding: '12px 24px' },
          },
        },
      ],
    };

    // Child component styles (extends parent)
    const childStyles: ExtractedStylesWithIdentity = {
      identity: childIdentity,
      extends: parentIdentity, // This is the key - child extends parent
      componentName: 'PrimaryButton',
      baseStyles: {
        backgroundColor: 'blue',
        color: 'white',
      },
      variants: [
        {
          prop: 'size',
          variants: {
            small: { fontWeight: 'bold' },
            large: { fontWeight: 'bold', textTransform: 'uppercase' },
          },
        },
      ],
    };

    // Register components in registry
    const parentEntry: ComponentEntry = {
      identity: parentIdentity,
      styles: parentStyles,
      lastModified: Date.now(),
      dependencies: [],
      dependents: new Set(),
    };

    const childEntry: ComponentEntry = {
      identity: childIdentity,
      styles: childStyles,
      lastModified: Date.now(),
      dependencies: [parentIdentity], // Child depends on parent
      dependents: new Set(),
    };

    // Manually add to registry (simulating what happens during extraction)
    (registry as any).components.set(parentIdentity.hash, parentEntry);
    (registry as any).components.set(childIdentity.hash, childEntry);

    // Generate layered CSS
    const layeredCSS = generator.generateLayeredCSS(registry, {});

    // Verify that parent comes before child in base styles
    const baseStylesSection = layeredCSS.baseStyles;
    expect(baseStylesSection).toBeTruthy();

    // Parent should appear before child
    const parentBaseIndex = baseStylesSection.indexOf('/* Button Base */');
    const childBaseIndex = baseStylesSection.indexOf(
      '/* PrimaryButton Base */'
    );

    expect(parentBaseIndex).toBeGreaterThanOrEqual(0);
    expect(childBaseIndex).toBeGreaterThanOrEqual(0);
    expect(parentBaseIndex).toBeLessThan(childBaseIndex);

    // Verify the same ordering in variant styles
    const variantStylesSection = layeredCSS.variantStyles;
    expect(variantStylesSection).toBeTruthy();

    const parentVariantIndex = variantStylesSection.indexOf(
      '/* Button size="small" */'
    );
    const childVariantIndex = variantStylesSection.indexOf(
      '/* PrimaryButton size="small" */'
    );

    expect(parentVariantIndex).toBeGreaterThanOrEqual(0);
    expect(childVariantIndex).toBeGreaterThanOrEqual(0);
    expect(parentVariantIndex).toBeLessThan(childVariantIndex);

    // Verify CSS specificity - all selectors should have equal specificity
    // so cascade order determines override behavior
    expect(baseStylesSection).toContain('.animus-Button-');
    expect(baseStylesSection).toContain('.animus-PrimaryButton-');
    expect(variantStylesSection).toContain('.animus-Button-');
    expect(variantStylesSection).toContain('.animus-PrimaryButton-');
  });

  it('handles complex extension chains', async () => {
    // Create a 3-level inheritance: Button -> PrimaryButton -> LargePrimaryButton
    const buttonIdentity = createComponentIdentity(
      'Button',
      '/test/Button.ts',
      'default'
    );
    const primaryIdentity = createComponentIdentity(
      'PrimaryButton',
      '/test/PrimaryButton.ts',
      'default'
    );
    const largePrimaryIdentity = createComponentIdentity(
      'LargePrimaryButton',
      '/test/LargePrimaryButton.ts',
      'default'
    );

    const buttonStyles: ExtractedStylesWithIdentity = {
      identity: buttonIdentity,
      componentName: 'Button',
      baseStyles: { padding: '8px' },
    };

    const primaryStyles: ExtractedStylesWithIdentity = {
      identity: primaryIdentity,
      extends: buttonIdentity,
      componentName: 'PrimaryButton',
      baseStyles: { backgroundColor: 'blue' },
    };

    const largePrimaryStyles: ExtractedStylesWithIdentity = {
      identity: largePrimaryIdentity,
      extends: primaryIdentity,
      componentName: 'LargePrimaryButton',
      baseStyles: { fontSize: '18px' },
    };

    // Register all components
    const buttonEntry: ComponentEntry = {
      identity: buttonIdentity,
      styles: buttonStyles,
      lastModified: Date.now(),
      dependencies: [],
      dependents: new Set(),
    };

    const primaryEntry: ComponentEntry = {
      identity: primaryIdentity,
      styles: primaryStyles,
      lastModified: Date.now(),
      dependencies: [buttonIdentity],
      dependents: new Set(),
    };

    const largePrimaryEntry: ComponentEntry = {
      identity: largePrimaryIdentity,
      styles: largePrimaryStyles,
      lastModified: Date.now(),
      dependencies: [primaryIdentity],
      dependents: new Set(),
    };

    (registry as any).components.set(buttonIdentity.hash, buttonEntry);
    (registry as any).components.set(primaryIdentity.hash, primaryEntry);
    (registry as any).components.set(
      largePrimaryIdentity.hash,
      largePrimaryEntry
    );

    // Generate CSS
    const layeredCSS = generator.generateLayeredCSS(registry, {});
    const baseStyles = layeredCSS.baseStyles;

    // Verify proper ordering: Button -> PrimaryButton -> LargePrimaryButton
    const buttonIndex = baseStyles.indexOf('/* Button Base */');
    const primaryIndex = baseStyles.indexOf('/* PrimaryButton Base */');
    const largePrimaryIndex = baseStyles.indexOf(
      '/* LargePrimaryButton Base */'
    );

    expect(buttonIndex).toBeLessThan(primaryIndex);
    expect(primaryIndex).toBeLessThan(largePrimaryIndex);
  });

  it('handles circular dependencies gracefully', async () => {
    // Create circular dependency (should not happen in practice but test resilience)
    const componentA = createComponentIdentity(
      'ComponentA',
      '/test/A.ts',
      'default'
    );
    const componentB = createComponentIdentity(
      'ComponentB',
      '/test/B.ts',
      'default'
    );

    const stylesA: ExtractedStylesWithIdentity = {
      identity: componentA,
      extends: componentB, // A extends B
      componentName: 'ComponentA',
      baseStyles: { color: 'red' },
    };

    const stylesB: ExtractedStylesWithIdentity = {
      identity: componentB,
      extends: componentA, // B extends A (circular!)
      componentName: 'ComponentB',
      baseStyles: { color: 'blue' },
    };

    const entryA: ComponentEntry = {
      identity: componentA,
      styles: stylesA,
      lastModified: Date.now(),
      dependencies: [componentB],
      dependents: new Set(),
    };

    const entryB: ComponentEntry = {
      identity: componentB,
      styles: stylesB,
      lastModified: Date.now(),
      dependencies: [componentA],
      dependents: new Set(),
    };

    (registry as any).components.set(componentA.hash, entryA);
    (registry as any).components.set(componentB.hash, entryB);

    // Should not throw or hang - topological sort should handle gracefully
    expect(() => {
      generator.generateLayeredCSS(registry, {});
    }).not.toThrow();
  });

  it('organizes styles by breakpoint within each cascade layer', async () => {
    // Create components with responsive styles
    const buttonIdentity = createComponentIdentity('Button', '/test/Button.ts', 'default');
    const primaryIdentity = createComponentIdentity('PrimaryButton', '/test/PrimaryButton.ts', 'default');

    const buttonStyles: ExtractedStylesWithIdentity = {
      identity: buttonIdentity,
      componentName: 'Button',
      baseStyles: {
        padding: { _: '8px', sm: '12px', lg: '16px' }, // Responsive padding
        color: 'black',
        fontSize: ['14px', '16px'], // Array syntax: base and xs
      },
      variants: [{
        prop: 'size',
        variants: {
          small: {
            padding: { _: '4px', sm: '6px' }, // Responsive variant styles
          },
          large: {
            padding: ['12px', '16px', '20px'], // Array syntax
          }
        }
      }],
      states: {
        hover: {
          transform: { _: 'scale(1.02)', md: 'scale(1.05)' }, // Responsive state
        }
      }
    };

    const primaryStyles: ExtractedStylesWithIdentity = {
      identity: primaryIdentity,
      extends: buttonIdentity,
      componentName: 'PrimaryButton',
      baseStyles: {
        backgroundColor: { _: 'blue', sm: 'darkblue' }, // Responsive bg
        fontWeight: 'bold',
      }
    };

    // Register components
    const buttonEntry: ComponentEntry = {
      identity: buttonIdentity,
      styles: buttonStyles,
      lastModified: Date.now(),
      dependencies: [],
      dependents: new Set()
    };

    const primaryEntry: ComponentEntry = {
      identity: primaryIdentity,
      styles: primaryStyles,
      lastModified: Date.now(),
      dependencies: [buttonIdentity],
      dependents: new Set()
    };

    (registry as any).components.set(buttonIdentity.hash, buttonEntry);
    (registry as any).components.set(primaryIdentity.hash, primaryEntry);

    const layeredCSS = generator.generateLayeredCSS(registry, {});

    // Verify breakpoint organization exists
    expect(layeredCSS.byBreakpoint).toBeDefined();
    expect(layeredCSS.byBreakpoint!.base).toBeDefined();
    expect(layeredCSS.byBreakpoint!.variants).toBeDefined();
    expect(layeredCSS.byBreakpoint!.states).toBeDefined();

    // Check base styles are organized by breakpoint
    const baseByBreakpoint = layeredCSS.byBreakpoint!.base;
    expect(baseByBreakpoint['_']).toContain('padding: 8px'); // Default
    expect(baseByBreakpoint['xs']).toContain('font-size: 16px'); // Array syntax
    expect(baseByBreakpoint['sm']).toContain('padding: 12px'); // Object syntax

    // Check variant styles are organized by breakpoint
    const variantsByBreakpoint = layeredCSS.byBreakpoint!.variants;
    expect(variantsByBreakpoint['_']).toContain('padding: 4px'); // Small variant default
    expect(variantsByBreakpoint['sm']).toContain('padding: 6px'); // Small variant sm

    // Check state styles are organized by breakpoint
    const statesByBreakpoint = layeredCSS.byBreakpoint!.states;
    expect(statesByBreakpoint['_']).toContain('transform: scale(1.02)');
    expect(statesByBreakpoint['md']).toContain('transform: scale(1.05)');

    // Verify the full CSS has proper media query structure
    const fullCSS = layeredCSS.fullCSS;
    
    // Base styles section should have breakpoint organization
    expect(fullCSS).toMatch(/\/\* Base Styles \*\/[\s\S]*?\/\* Base Styles - SM \*\//);
    expect(fullCSS).toMatch(/@media screen and \(min-width: 768px\)/);
    
    // Verify parent-child ordering is maintained within each breakpoint
    const baseDefault = baseByBreakpoint['_'];
    const buttonDefaultIndex = baseDefault.indexOf('/* Button Base */');
    const primaryDefaultIndex = baseDefault.indexOf('/* PrimaryButton Base */');
    expect(buttonDefaultIndex).toBeLessThan(primaryDefaultIndex);

    // Same ordering should be preserved in responsive breakpoints
    if (baseByBreakpoint['sm']) {
      const baseSm = baseByBreakpoint['sm'];
      const buttonSmIndex = baseSm.indexOf('/* Button Base */');
      const primarySmIndex = baseSm.indexOf('/* PrimaryButton Base */');
      if (buttonSmIndex >= 0 && primarySmIndex >= 0) {
        expect(buttonSmIndex).toBeLessThan(primarySmIndex);
      }
    }
  });

  it('generates proper layered CSS structure - snapshot', async () => {
    // Create a comprehensive component hierarchy for snapshot testing
    const buttonIdentity = createComponentIdentity('Button', '/test/Button.ts', 'default');
    const primaryIdentity = createComponentIdentity('PrimaryButton', '/test/PrimaryButton.ts', 'default');
    const cardIdentity = createComponentIdentity('Card', '/test/Card.ts', 'default');

    // Base Button component
    const buttonStyles: ExtractedStylesWithIdentity = {
      identity: buttonIdentity,
      componentName: 'Button',
      baseStyles: {
        padding: '8px 16px',
        borderRadius: '4px',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '14px',
        transition: 'all 0.2s ease'
      },
      variants: [{
        prop: 'size',
        variants: {
          small: {
            padding: '4px 8px',
            fontSize: '12px'
          },
          large: {
            padding: '12px 24px',
            fontSize: '16px'
          }
        }
      }, {
        prop: 'variant',
        variants: {
          outline: {
            backgroundColor: 'transparent',
            border: '2px solid currentColor'
          },
          ghost: {
            backgroundColor: 'transparent',
            border: 'none'
          }
        }
      }],
      states: {
        disabled: {
          opacity: 0.6,
          cursor: 'not-allowed'
        },
        loading: {
          position: 'relative',
          color: 'transparent',
          '&::after': {
            content: '""',
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '16px',
            height: '16px',
            margin: '-8px 0 0 -8px',
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite'
          }
        }
      },
      groups: ['space', 'color'],
      props: {
        elevation: {
          property: 'boxShadow',
          scale: 'shadows'
        }
      }
    };

    // Extended PrimaryButton
    const primaryStyles: ExtractedStylesWithIdentity = {
      identity: primaryIdentity,
      extends: buttonIdentity,
      componentName: 'PrimaryButton',
      baseStyles: {
        backgroundColor: '#007bff',
        color: 'white',
        fontWeight: '600'
      },
      variants: [{
        prop: 'size',
        variants: {
          small: {
            fontWeight: 'bold'
          },
          large: {
            fontWeight: 'bold',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }
        }
      }],
      states: {
        disabled: {
          backgroundColor: '#6c757d',
          opacity: 0.8
        }
      }
    };

    // Independent Card component (no extension)
    const cardStyles: ExtractedStylesWithIdentity = {
      identity: cardIdentity,
      componentName: 'Card',
      baseStyles: {
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        padding: '16px'
      },
      variants: [{
        prop: 'variant',
        variants: {
          elevated: {
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          },
          outlined: {
            border: '1px solid #e0e0e0',
            boxShadow: 'none'
          }
        }
      }],
      states: {
        interactive: {
          cursor: 'pointer',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 6px 16px rgba(0,0,0,0.15)'
          }
        }
      }
    };

    // Register components in registry
    const buttonEntry: ComponentEntry = {
      identity: buttonIdentity,
      styles: buttonStyles,
      lastModified: Date.now(),
      dependencies: [],
      dependents: new Set()
    };

    const primaryEntry: ComponentEntry = {
      identity: primaryIdentity,
      styles: primaryStyles,
      lastModified: Date.now(),
      dependencies: [buttonIdentity], // PrimaryButton extends Button
      dependents: new Set()
    };

    const cardEntry: ComponentEntry = {
      identity: cardIdentity,
      styles: cardStyles,
      lastModified: Date.now(),
      dependencies: [],
      dependents: new Set()
    };

    (registry as any).components.set(buttonIdentity.hash, buttonEntry);
    (registry as any).components.set(primaryIdentity.hash, primaryEntry);
    (registry as any).components.set(cardIdentity.hash, cardEntry);

    // Generate layered CSS with some group definitions
    const groupDefinitions = {
      space: {
        m: { property: 'margin', scale: 'space' },
        p: { property: 'padding', scale: 'space' },
        px: { properties: ['paddingLeft', 'paddingRight'], scale: 'space' },
        py: { properties: ['paddingTop', 'paddingBottom'], scale: 'space' }
      },
      color: {
        bg: { property: 'backgroundColor', scale: 'colors' },
        color: { property: 'color', scale: 'colors' }
      }
    };

    // Create mock usage data to simulate real prop usage
    const mockUsageMap: Record<string, UsageMap> = {
      Button: {
        Button: {
          // Group props usage
          m: new Set(['1:_', '2:sm', '0:lg']), // margin values at different breakpoints
          p: new Set(['2:_', '4:md']), // padding values
          px: new Set(['3:_']), // horizontal padding
          bg: new Set(['primary:_', 'secondary:hover']), // background colors
          color: new Set(['white:_', 'black:sm']), // text colors
          // Custom props usage
          elevation: new Set(['1:_', '2:hover', '3:lg']) // box shadow elevation
        }
      },
      PrimaryButton: {
        PrimaryButton: {
          // Inherited + additional usage
          m: new Set(['1:_', '3:lg']), // different margin usage
          px: new Set(['4:_', '6:xl']), // larger horizontal padding
          bg: new Set(['accent:_']), // different background
          elevation: new Set(['2:_', '4:active']) // higher elevation
        }
      },
      Card: {
        Card: {
          p: new Set(['4:_', '6:sm', '8:lg']), // responsive padding
          m: new Set(['2:_']), // margin
          bg: new Set(['surface:_', 'elevated:hover']), // surface colors
          color: new Set(['text:_', 'muted:disabled']) // text colors
        }
      }
    };

    // Add theme data to demonstrate CSS variable generation
    const mockTheme = {
      colors: {
        primary: '#007bff',
        secondary: '#6c757d',
        accent: '#28a745',
        surface: '#f8f9fa',
        elevated: '#ffffff',
        text: '#212529',
        muted: '#6c757d',
        white: '#ffffff',
        black: '#000000'
      },
      space: {
        0: '0px',
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px'
      },
      shadows: {
        1: '0 1px 3px rgba(0,0,0,0.12)',
        2: '0 4px 6px rgba(0,0,0,0.1)',
        3: '0 10px 20px rgba(0,0,0,0.15)',
        4: '0 25px 50px rgba(0,0,0,0.25)'
      }
    };

    const layeredCSS = generator.generateLayeredCSS(registry, groupDefinitions, mockTheme, mockUsageMap);

    // Snapshot the full CSS structure
    expect(layeredCSS.fullCSS).toMatchSnapshot('complete-layered-css-output');

    // Snapshot individual layers for detailed inspection
    expect(layeredCSS.cssVariables).toMatchSnapshot('css-variables-layer');
    expect(layeredCSS.baseStyles).toMatchSnapshot('base-styles-layer');
    expect(layeredCSS.variantStyles).toMatchSnapshot('variant-styles-layer');
    expect(layeredCSS.stateStyles).toMatchSnapshot('state-styles-layer');
    expect(layeredCSS.atomicUtilities).toMatchSnapshot('atomic-utilities-layer');

    // Verify extension ordering in base styles
    const baseStyles = layeredCSS.baseStyles;
    const buttonIndex = baseStyles.indexOf('/* Button Base */');
    const primaryIndex = baseStyles.indexOf('/* PrimaryButton Base */');
    const cardIndex = baseStyles.indexOf('/* Card Base */');

    expect(buttonIndex).toBeLessThan(primaryIndex); // Parent before child
    expect(cardIndex).toBeGreaterThanOrEqual(0); // Independent component present

    // Verify each layer has content
    expect(layeredCSS.baseStyles.length).toBeGreaterThan(0);
    expect(layeredCSS.variantStyles.length).toBeGreaterThan(0);
    expect(layeredCSS.stateStyles.length).toBeGreaterThan(0);
  });
});
