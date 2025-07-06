/**
 * [QUANTUM] Extension Cascade Ordering Tests
 *
 * Tests the correct CSS cascade ordering for component inheritance chains.
 * Uses mock component graphs to verify that child components always come
 * after their parents in the generated CSS output.
 */

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import type { ComponentEntry } from '../component-registry';
import { ComponentRegistry } from '../component-registry';
import { CSSGenerator } from '../generator';
import {
  ,
  extractComponentNames,
  parseCSSOrder,
  testGroups,
  testTheme,
  verifyCascadeOverride,
} from './test-utils';
import { createDiamondInheritance, createMockComponentNode } from './test-utils/mock-builders';

describe('[QUANTUM] Extension Cascade Ordering', () => {
  const generator = new CSSGenerator({ prefix: 'animus' });

  // Create a mock program for ComponentRegistry
  const mockProgram = ts.createProgram([], {});

  it('should maintain parent → child cascade order in CSS output', () => {
    // Create parent → child relationship
    const parent = createMockComponentNode({
      name: 'Button',
      extraction: {
        baseStyles: {
          padding: '8px 16px',
          borderRadius: '4px',
          backgroundColor: 'white',
          color: 'black',
        },
      },
    });

    const child = createMockComponentNode({
      name: 'PrimaryButton',
      parentHash: parent.identity.hash,
      extraction: {
        baseStyles: {
          backgroundColor: 'blue',
          color: 'white',
          fontWeight: 'bold',
        },
      },
    });

    // Create registry and add components
    const registry = new ComponentRegistry(mockProgram);
    const parentEntry: ComponentEntry = {
      identity: parent.identity,
      styles: {
        identity: parent.identity,
        componentName: parent.identity.name,
        baseStyles: parent.extraction.baseStyles,
        states: parent.extraction.states,
      },
      lastModified: Date.now(),
      dependencies: [],
      dependents: new Set(),
    };

    const childEntry: ComponentEntry = {
      identity: child.identity,
      styles: {
        identity: child.identity,
        extends: parent.identity,
        componentName: child.identity.name,
        baseStyles: child.extraction.baseStyles,
        states: child.extraction.states,
      },
      lastModified: Date.now(),
      dependencies: [parent.identity],
      dependents: new Set(),
    };

    (registry as any).components.set(parent.identity.hash, parentEntry);
    (registry as any).components.set(child.identity.hash, childEntry);

    const result = generator.generateLayeredCSS(
      registry,
      testGroups,
      testTheme
    );

    // Extract component order from base styles
    const componentOrder = extractComponentNames(result.baseStyles);

    // Parent must come before child
    expect(componentOrder).toEqual(['Button', 'PrimaryButton']);

    // Verify style overrides work correctly
    const parentClass = result.baseStyles
      .match(/\.animus-Button-\w+/)?.[0]
      ?.slice(1);
    const childClass = result.baseStyles
      .match(/\.animus-PrimaryButton-\w+/)?.[0]
      ?.slice(1);

    if (parentClass && childClass) {
      const override = verifyCascadeOverride(
        result.baseStyles,
        parentClass,
        childClass,
        'background-color'
      );

      expect(override.parentValue).toBe('white');
      expect(override.childValue).toBe('blue');
      expect(override.properlyOverrides).toBe(true);
    }
  });

  it('should handle multi-level inheritance chains (A → B → C)', () => {
    const components = [
      'BaseButton',
      'Button',
      'PrimaryButton',
      'LargePrimaryButton',
    ];
    const registry = new ComponentRegistry(mockProgram);

    // Create chain of components
    let prevIdentity = null;
    for (let i = 0; i < components.length; i++) {
      const node = createMockComponentNode({
        name: components[i],
        parentHash: prevIdentity?.hash,
        extraction: {
          baseStyles: {
            padding: '4px',
            [`level${i}`]: `value${i}`,
          },
        },
      });

      const entry: ComponentEntry = {
        identity: node.identity,
        styles: {
          identity: node.identity,
          extends: prevIdentity || undefined,
          componentName: node.identity.name,
          baseStyles: node.extraction.baseStyles,
        },
        lastModified: Date.now(),
        dependencies: prevIdentity ? [prevIdentity] : [],
        dependents: new Set(),
      };

      (registry as any).components.set(node.identity.hash, entry);
      prevIdentity = node.identity;
    }

    const result = generator.generateLayeredCSS(
      registry,
      testGroups,
      testTheme
    );
    const componentOrder = extractComponentNames(result.baseStyles);

    // Verify strict ordering
    expect(componentOrder).toEqual(components);
  });

  it('should handle diamond inheritance patterns', () => {
    const registry = new ComponentRegistry(mockProgram);
    const graph = createDiamondInheritance({
      baseStyles: { position: 'relative', padding: '10px' },
      leftStyles: { color: 'blue', margin: '5px' },
      rightStyles: { color: 'red', border: '1px solid' },
      mergedStyles: { color: 'green', fontSize: '16px' },
    });

    // Add all components to registry
    for (const [hash, node] of graph.components) {
      const entry: ComponentEntry = {
        identity: node.identity,
        styles: {
          identity: node.identity,
          extends: node.extends,
          componentName: node.identity.name,
          baseStyles: node.extraction.baseStyles,
        },
        lastModified: Date.now(),
        dependencies: node.extends ? [node.extends] : [],
        dependents: new Set(),
      };
      (registry as any).components.set(hash, entry);
    }

    const result = generator.generateLayeredCSS(
      registry,
      testGroups,
      testTheme
    );
    const componentOrder = extractComponentNames(result.baseStyles);

    // Base must come first, Left/Right can be in any order, Merged must be last
    expect(componentOrder[0]).toBe('Base');
    expect(componentOrder[componentOrder.length - 1]).toBe('Merged');
    expect(componentOrder).toContain('Left');
    expect(componentOrder).toContain('Right');
  });

  it('should maintain cascade order for variants', () => {
    const registry = new ComponentRegistry(mockProgram);

    const parent = createMockComponentNode({
      name: 'Button',
      extraction: {
        baseStyles: { padding: '8px' },
        variants: {
          size: {
            small: { padding: '4px', fontSize: '12px' },
            large: { padding: '16px', fontSize: '18px' },
          },
        },
      },
    });

    const child = createMockComponentNode({
      name: 'PrimaryButton',
      parentHash: parent.identity.hash,
      extraction: {
        baseStyles: { backgroundColor: 'blue' },
        variants: {
          size: {
            small: { fontWeight: 'bold' },
            large: { fontWeight: 'bold', textTransform: 'uppercase' },
          },
        },
      },
    });

    // Add to registry
    const parentEntry: ComponentEntry = {
      identity: parent.identity,
      styles: {
        identity: parent.identity,
        componentName: parent.identity.name,
        baseStyles: parent.extraction.baseStyles,
        variants: parent.extraction.variants ? [
          {
            prop: 'size',
            variants: parent.extraction.variants.size || {},
          },
        ] : undefined,
      },
      lastModified: Date.now(),
      dependencies: [],
      dependents: new Set(),
    };

    const childEntry: ComponentEntry = {
      identity: child.identity,
      styles: {
        identity: child.identity,
        extends: parent.identity,
        componentName: child.identity.name,
        baseStyles: child.extraction.baseStyles,
        variants: child.extraction.variants ? [
          {
            prop: 'size',
            variants: child.extraction.variants.size || {},
          },
        ] : undefined,
      },
      lastModified: Date.now(),
      dependencies: [parent.identity],
      dependents: new Set(),
    };

    (registry as any).components.set(parent.identity.hash, parentEntry);
    (registry as any).components.set(child.identity.hash, childEntry);

    const result = generator.generateLayeredCSS(
      registry,
      testGroups,
      testTheme
    );

    // Check variant layer ordering
    const variantOrder = parseCSSOrder(result.variantStyles);
    const buttonSmallIndex = variantOrder.findIndex(
      (c) => c.includes('Button') && c.includes('small')
    );
    const primarySmallIndex = variantOrder.findIndex(
      (c) => c.includes('PrimaryButton') && c.includes('small')
    );

    expect(buttonSmallIndex).toBeLessThan(primarySmallIndex);
  });

  it('should maintain cascade order for states', () => {
    const registry = new ComponentRegistry(mockProgram);

    const parent = createMockComponentNode({
      name: 'Button',
      extraction: {
        baseStyles: { cursor: 'pointer' },
        states: {
          hover: { transform: 'translateY(-1px)' },
          disabled: { opacity: 0.6, cursor: 'not-allowed' },
        },
      },
    });

    const child = createMockComponentNode({
      name: 'PrimaryButton',
      parentHash: parent.identity.hash,
      extraction: {
        baseStyles: { backgroundColor: 'blue' },
        states: {
          hover: { backgroundColor: 'darkblue' },
          disabled: { backgroundColor: '#ccc' },
        },
      },
    });

    // Add to registry
    const parentEntry: ComponentEntry = {
      identity: parent.identity,
      styles: {
        identity: parent.identity,
        componentName: parent.identity.name,
        baseStyles: parent.extraction.baseStyles,
        states: parent.extraction.states,
      },
      lastModified: Date.now(),
      dependencies: [],
      dependents: new Set(),
    };

    const childEntry: ComponentEntry = {
      identity: child.identity,
      styles: {
        identity: child.identity,
        extends: parent.identity,
        componentName: child.identity.name,
        baseStyles: child.extraction.baseStyles,
        states: child.extraction.states,
      },
      lastModified: Date.now(),
      dependencies: [parent.identity],
      dependents: new Set(),
    };

    (registry as any).components.set(parent.identity.hash, parentEntry);
    (registry as any).components.set(child.identity.hash, childEntry);

    const result = generator.generateLayeredCSS(
      registry,
      testGroups,
      testTheme
    );

    // Check state layer ordering
    const stateOrder = parseCSSOrder(result.stateStyles);
    const buttonHoverIndex = stateOrder.findIndex(
      (c) => c.includes('Button') && c.includes('hover')
    );
    const primaryHoverIndex = stateOrder.findIndex(
      (c) => c.includes('PrimaryButton') && c.includes('hover')
    );

    expect(buttonHoverIndex).toBeLessThan(primaryHoverIndex);
  });

  it('should handle circular dependencies gracefully', () => {
    const registry = new ComponentRegistry(mockProgram);

    // Create circular dependency A → B → A
    const nodeA = createMockComponentNode({
      name: 'ComponentA',
      hash: 'hash-a',
      extraction: { baseStyles: { color: 'red' } },
    });

    const nodeB = createMockComponentNode({
      name: 'ComponentB',
      hash: 'hash-b',
      parentHash: 'hash-a',
      extraction: { baseStyles: { color: 'blue' } },
    });

    // Create circular reference
    nodeA.extends = {
      name: 'ComponentB',
      hash: 'hash-b',
      filePath: '/test/ComponentB.tsx',
      exportName: 'ComponentB',
    };

    const entryA: ComponentEntry = {
      identity: nodeA.identity,
      styles: {
        identity: nodeA.identity,
        extends: nodeB.identity,
        componentName: nodeA.identity.name,
        baseStyles: nodeA.extraction.baseStyles,
      },
      lastModified: Date.now(),
      dependencies: [nodeB.identity],
      dependents: new Set(),
    };

    const entryB: ComponentEntry = {
      identity: nodeB.identity,
      styles: {
        identity: nodeB.identity,
        extends: nodeA.identity,
        componentName: nodeB.identity.name,
        baseStyles: nodeB.extraction.baseStyles,
      },
      lastModified: Date.now(),
      dependencies: [nodeA.identity],
      dependents: new Set(),
    };

    (registry as any).components.set(nodeA.identity.hash, entryA);
    (registry as any).components.set(nodeB.identity.hash, entryB);

    // Should not throw or hang
    expect(() =>
      generator.generateLayeredCSS(registry, testGroups, testTheme)
    ).not.toThrow();
  });

  it('should preserve cascade order across responsive breakpoints', () => {
    const registry = new ComponentRegistry(mockProgram);

    const parent = createMockComponentNode({
      name: 'Button',
      extraction: {
        baseStyles: {
          padding: { _: '8px', sm: '12px', lg: '16px' },
          fontSize: ['14px', '16px', null, '18px'], // Array syntax
        },
        variants: {
          size: {
            small: {
              padding: { _: '4px', sm: '6px' },
            },
          },
        },
        states: {
          hover: {
            transform: { _: 'scale(1.02)', md: 'scale(1.05)' },
          },
        },
      },
    });

    const child = createMockComponentNode({
      name: 'PrimaryButton',
      parentHash: parent.identity.hash,
      extraction: {
        baseStyles: {
          backgroundColor: { _: 'blue', sm: 'darkblue' },
        },
      },
    });

    // Add to registry
    const parentEntry: ComponentEntry = {
      identity: parent.identity,
      styles: {
        identity: parent.identity,
        componentName: parent.identity.name,
        baseStyles: parent.extraction.baseStyles,
        variants: parent.extraction.variants ? [
          {
            prop: 'size',
            variants: parent.extraction.variants.size || {},
          },
        ] : undefined,
        states: parent.extraction.states,
      },
      lastModified: Date.now(),
      dependencies: [],
      dependents: new Set(),
    };

    const childEntry: ComponentEntry = {
      identity: child.identity,
      styles: {
        identity: child.identity,
        extends: parent.identity,
        componentName: child.identity.name,
        baseStyles: child.extraction.baseStyles,
      },
      lastModified: Date.now(),
      dependencies: [parent.identity],
      dependents: new Set(),
    };

    (registry as any).components.set(parent.identity.hash, parentEntry);
    (registry as any).components.set(child.identity.hash, childEntry);

    const result = generator.generateLayeredCSS(
      registry,
      testGroups,
      testTheme
    );

    // Verify breakpoint organization exists
    expect(result.byBreakpoint).toBeDefined();
    expect(result.byBreakpoint?.base).toBeDefined();
    expect(result.byBreakpoint?.base['_']).toBeDefined();

    // Check parent-child order is maintained in base styles
    const componentOrder = extractComponentNames(result.baseStyles);
    expect(componentOrder).toEqual(['Button', 'PrimaryButton']);
  });

  it('should generate comprehensive layered CSS structure', () => {
    const registry = new ComponentRegistry(mockProgram);

    // Create a real-world-like component hierarchy
    const button = createMockComponentNode({
      name: 'Button',
      extraction: {
        baseStyles: {
          padding: '8px 16px',
          borderRadius: '4px',
          border: 'none',
          cursor: 'pointer',
          fontSize: '14px',
          transition: 'all 0.2s ease',
        },
        variants: {
          size: {
            small: { padding: '4px 8px', fontSize: '12px' },
            large: { padding: '12px 24px', fontSize: '16px' },
          },
          variant: {
            outline: {
              backgroundColor: 'transparent',
              border: '2px solid currentColor',
            },
            ghost: {
              backgroundColor: 'transparent',
              border: 'none',
            },
          },
        },
        states: {
          disabled: {
            opacity: 0.6,
            cursor: 'not-allowed',
          },
          loading: {
            position: 'relative',
            color: 'transparent',
          },
        },
      },
      groups: ['space', 'color'],
    });

    const primaryButton = createMockComponentNode({
      name: 'PrimaryButton',
      parentHash: button.identity.hash,
      extraction: {
        baseStyles: {
          backgroundColor: '#007bff',
          color: 'white',
          fontWeight: '600',
        },
        variants: {
          size: {
            small: { fontWeight: 'bold' },
            large: {
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            },
          },
        },
        states: {
          disabled: {
            backgroundColor: '#6c757d',
            opacity: 0.8,
          },
        },
      },
    });

    const card = createMockComponentNode({
      name: 'Card',
      extraction: {
        baseStyles: {
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          padding: '16px',
        },
        variants: {
          variant: {
            elevated: {
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            },
            outlined: {
              border: '1px solid #e0e0e0',
              boxShadow: 'none',
            },
          },
        },
        states: {
          interactive: {
            cursor: 'pointer',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: '0 6px 16px rgba(0,0,0,0.15)',
            },
          },
        },
      },
    });

    // Create entries with proper variant structure
    const createVariants = (variants: Record<string, any>) => {
      return Object.entries(variants).map(([prop, values]) => ({
        prop,
        variants: values,
      }));
    };

    const buttonEntry: ComponentEntry = {
      identity: button.identity,
      styles: {
        identity: button.identity,
        componentName: button.identity.name,
        baseStyles: button.extraction.baseStyles,
        variants: createVariants(button.extraction.variants || {}),
        states: button.extraction.states,
        groups: button.groups,
      },
      lastModified: Date.now(),
      dependencies: [],
      dependents: new Set(),
    };

    const primaryEntry: ComponentEntry = {
      identity: primaryButton.identity,
      styles: {
        identity: primaryButton.identity,
        extends: button.identity,
        componentName: primaryButton.identity.name,
        baseStyles: primaryButton.extraction.baseStyles,
        variants: createVariants(primaryButton.extraction.variants || {}),
        states: primaryButton.extraction.states,
      },
      lastModified: Date.now(),
      dependencies: [button.identity],
      dependents: new Set(),
    };

    const cardEntry: ComponentEntry = {
      identity: card.identity,
      styles: {
        identity: card.identity,
        componentName: card.identity.name,
        baseStyles: card.extraction.baseStyles,
        variants: createVariants(card.extraction.variants || {}),
        states: card.extraction.states,
      },
      lastModified: Date.now(),
      dependencies: [],
      dependents: new Set(),
    };

    (registry as any).components.set(button.identity.hash, buttonEntry);
    (registry as any).components.set(primaryButton.identity.hash, primaryEntry);
    (registry as any).components.set(card.identity.hash, cardEntry);

    const result = generator.generateLayeredCSS(
      registry,
      testGroups,
      testTheme
    );

    // Verify all layers exist and have content
    expect(result.baseStyles).toBeTruthy();
    expect(result.variantStyles).toBeTruthy();
    expect(result.stateStyles).toBeTruthy();

    // Verify extension ordering in component layer
    const componentOrder = extractComponentNames(result.baseStyles);
    const buttonIndex = componentOrder.indexOf('Button');
    const primaryIndex = componentOrder.indexOf('PrimaryButton');
    const cardIndex = componentOrder.indexOf('Card');

    expect(buttonIndex).toBeLessThan(primaryIndex); // Parent before child
    expect(cardIndex).toBeGreaterThanOrEqual(0); // Independent component present

    // Verify CSS structure
    const css = result.fullCSS;
    expect(css).toContain('/* Base Styles */');
    expect(css).toContain('/* Variant Styles */');
    expect(css).toContain('/* State Styles */');
  });
});
