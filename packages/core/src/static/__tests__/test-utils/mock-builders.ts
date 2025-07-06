/**
 * Enhanced mock builders for component graphs and nodes
 * Supports complex inheritance patterns including diamond inheritance
 */

import type { ComponentGraph, ComponentNode } from '../../component-graph';
import type { ComponentIdentity } from '../../component-identity';
import type { ExtractedStyles } from '../../types';

export interface MockComponentConfig {
  name: string;
  hash?: string;
  filePath?: string;
  exportName?: string;
  parentHash?: string;
  secondaryParents?: string[]; // For diamond inheritance
  extraction?: Partial<ExtractedStyles>;
  metadata?: {
    className?: string;
    elementType?: string;
    [key: string]: any;
  };
  variants?: Record<string, any>;
  states?: string[];
  groups?: string[];
  props?: Record<string, any>;
}

/**
 * Creates a mock ComponentIdentity
 */
export function createMockIdentity(config: {
  name: string;
  filePath?: string;
  exportName?: string;
  hash?: string;
}): ComponentIdentity {
  return {
    name: config.name,
    filePath: config.filePath || `/test/components/${config.name}.tsx`,
    exportName: config.exportName || config.name,
    hash: config.hash || `hash-${config.name.toLowerCase()}`,
  };
}

/**
 * Creates a mock ComponentNode with full configuration support
 */
export function createMockComponentNode(
  config: any
): ComponentNode {
  const hash = config.hash || `hash-${config.name.toLowerCase()}`;

  // Build extraction with defaults
  const extraction: any = {
    baseStyles: config.extraction?.baseStyles || {},
    variants: config.extraction?.variants || {},
    states: config.extraction?.states || {},
    defaultVariants: config.extraction?.defaultVariants || {},
    compoundVariants: config.extraction?.compoundVariants || [],
    conditions: config.extraction?.conditions || {},
    responsiveBreakpoints: config.extraction?.responsiveBreakpoints || {},
  };

  // Build metadata
  const metadata = {
    id: `${config.name}-id`,
    className:
      config.metadata?.className || `${config.name}-${hash.slice(0, 6)}`,
    elementType: config.metadata?.elementType || 'div',
    hash: hash,
    parentHash: config.parentHash,
    ...config.metadata,
  };

  // Build variants map
  const allVariants: Record<string, any> = {};
  if (config.variants) {
    for (const [prop, values] of Object.entries(config.variants)) {
      if (typeof values !== 'object' && values !== null) continue;
      const vals = Array.isArray(values) ?  values : Object.keys(values!);
      allVariants[prop] = {
        prop,
        values: new Set(vals),
        defaultValue: vals[0],
      };
    }
  }

  return {
    identity: createMockIdentity({
      name: config.name,
      filePath: config.filePath,
      exportName: config.exportName,
      hash,
    }),
    extraction,
    metadata,
    allVariants,
    allStates: new Set(config.states || []),
    allProps: config.props || {},
    groups: config.groups || [],
    extends: config.parentHash
      ? {
          name: `Parent-${config.parentHash}`,
          hash: config.parentHash,
          filePath: `/test/components/Parent.tsx`,
          exportName: 'Parent',
        }
      : undefined,
  };
}

/**
 * Creates a mock component graph with relationships
 */
export function createMockComponentGraph(config: {
  components?: MockComponentConfig[];
  relationships?: Array<{ child: string; parent: string }>;
}): ComponentGraph {
  const components = new Map<string, ComponentNode>();

  // First pass: create all components
  if (config.components) {
    for (const compConfig of config.components) {
      const node = createMockComponentNode(compConfig);
      components.set(node.identity.hash, node);
    }
  }

  // Second pass: establish relationships
  if (config.relationships) {
    for (const rel of config.relationships) {
      const childNode = Array.from(components.values()).find(
        (c) => c.identity.name === rel.child
      );
      const parentNode = Array.from(components.values()).find(
        (c) => c.identity.name === rel.parent
      );

      if (childNode && parentNode) {
        childNode.extends = parentNode.identity;
        childNode.metadata.extends = {
          hash: parentNode.identity.hash,
          from: parentNode.identity.name
        };
      }
    }
  }

  return {
    components,
    metadata: {
      timestamp: new Date().getTime(),
      projectRoot: '/test',
      totalComponents: components.size,
      totalVariants: components.size * 1, // 1 variant per component
      totalStates: components.size * 3, // 3 states per component
    },
  };
}

/**
 * Creates a linear inheritance chain: A → B → C → ...
 */
export function createLinearInheritanceChain(
  componentNames: string[],
  baseStyles: Record<string, any> = {}
): ComponentGraph {
  const configs: MockComponentConfig[] = [];

  for (let i = 0; i < componentNames.length; i++) {
    const config: MockComponentConfig = {
      name: componentNames[i],
      extraction: {
        baseStyles: {
          ...baseStyles,
          // Each level adds its own style
          [`level${i}`]: `value${i}`,
        },
      },
    };

    // Set parent relationship (except for first component)
    if (i > 0) {
      config.parentHash = `hash-${componentNames[i - 1].toLowerCase()}`;
    }

    configs.push(config);
  }

  return createMockComponentGraph({ components: configs });
}

/**
 * Creates a diamond inheritance pattern:
 *     Base
 *    /    \
 *  Left   Right
 *    \    /
 *    Merged
 */
export function createDiamondInheritance(config?: {
  baseStyles?: Record<string, any>;
  leftStyles?: Record<string, any>;
  rightStyles?: Record<string, any>;
  mergedStyles?: Record<string, any>;
}): ComponentGraph {
  const base = createMockComponentNode({
    name: 'Base',
    extraction: {
      baseStyles: config?.baseStyles || { color: 'black', padding: '10px' },
    },
  });

  const left = createMockComponentNode({
    name: 'Left',
    parentHash: base.identity.hash,
    extraction: {
      baseStyles: config?.leftStyles || { color: 'blue', margin: '5px' },
    },
  });

  const right = createMockComponentNode({
    name: 'Right',
    parentHash: base.identity.hash,
    extraction: {
      baseStyles: config?.rightStyles || { color: 'red', border: '1px solid' },
    },
  });

  const merged = createMockComponentNode({
    name: 'Merged',
    parentHash: left.identity.hash,
    secondaryParents: [right.identity.hash],
    extraction: {
      baseStyles: config?.mergedStyles || { color: 'green', fontSize: '16px' },
    },
  });

  return {
    fileDependencies: new Set([
      '/test/base.tsx',
      '/test/left.tsx',
      '/test/right.tsx',
      '/test/merged.tsx',
    ]),
    components: new Map([
      [base.identity.hash, base],
      [left.identity.hash, left],
      [right.identity.hash, right],
      [merged.identity.hash, merged],
    ]),
    metadata: {
      timestamp: new Date().getTime(),
      projectRoot: '/test',
      totalComponents: 4,
      totalVariants: 4,
      totalStates: 3,
    },
  };
}

/**
 * Creates a component graph with variants and states
 */
export function createVariantStateGraph(): ComponentGraph {
  const button = createMockComponentNode({
    name: 'Button',
    extraction: {
      baseStyles: { padding: '8px 16px' },
      variants: {
        size: {
          small: { fontSize: '12px', padding: '4px 8px' },
          medium: { fontSize: '14px', padding: '8px 16px' },
          large: { fontSize: '16px', padding: '12px 24px' },
        },
        variant: {
          primary: { backgroundColor: 'blue', color: 'white' },
          secondary: { backgroundColor: 'gray', color: 'black' },
        },
      },
      states: {
        hover: { opacity: '0.8' },
        disabled: { opacity: '0.5', cursor: 'not-allowed' },
      },
      defaultVariants: {
        size: 'medium',
        variant: 'primary',
      },
    },
    variants: {
      size: { small: {}, medium: {}, large: {} },
      variant: { primary: {}, secondary: {} },
    },
    states: ['hover', 'disabled'],
  });

  const iconButton = createMockComponentNode({
    name: 'IconButton',
    parentHash: button.identity.hash,
    extraction: {
      baseStyles: { display: 'inline-flex', alignItems: 'center', gap: '4px' },
      variants: {
        iconPosition: {
          left: { flexDirection: 'row' },
          right: { flexDirection: 'row-reverse' },
        },
      },
    },
    variants: {
      iconPosition: { left: {}, right: {} },
    },
  });

  return createMockComponentGraph({
    components: [button, iconButton].map((node) => ({
      name: node.identity.name,
      hash: node.identity.hash,
      parentHash: node.metadata.extends?.hash,
      extraction: node.extraction,
      variants: node.allVariants,
      states: Array.from(node.allStates),
    })),
  });
}

/**
 * Creates a complex real-world-like component graph
 */
export function createRealWorldGraph(): ComponentGraph {
  return createMockComponentGraph({
    components: [
      {
        name: 'Box',
        extraction: {
          baseStyles: { boxSizing: 'border-box' },
        },
        groups: ['space', 'color', 'layout'],
      },
      {
        name: 'Flex',
        parentHash: 'hash-box',
        extraction: {
          baseStyles: { display: 'flex' },
        },
        groups: ['flex'],
      },
      {
        name: 'Button',
        parentHash: 'hash-box',
        extraction: {
          baseStyles: {
            cursor: 'pointer',
            border: 'none',
            borderRadius: '4px',
            fontFamily: 'inherit',
          },
          variants: {
            size: {
              sm: { fontSize: '14px', padding: '4px 8px' },
              md: { fontSize: '16px', padding: '8px 16px' },
              lg: { fontSize: '18px', padding: '12px 24px' },
            },
          },
          states: {
            hover: { transform: 'translateY(-1px)' },
            active: { transform: 'translateY(0)' },
            disabled: { opacity: 0.6, cursor: 'not-allowed' },
          },
        },
      },
      {
        name: 'IconButton',
        parentHash: 'hash-button',
        extraction: {
          baseStyles: {
            padding: '8px',
            minWidth: 'auto',
          },
        },
      },
      {
        name: 'Card',
        parentHash: 'hash-box',
        extraction: {
          baseStyles: {
            padding: '16px',
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          },
        },
      },
    ],
  });
}
