/**
 * Unified Test Utilities for Animus Static Extraction Tests
 * One stop shop for all testing needs
 *
 * Following the Quantum Test Oracle's philosophy:
 * "Tests are quantum observers that collapse the superposition of working/broken into definite states"
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import ts from 'typescript';
import { afterEach, beforeEach, expect, vi } from 'vitest';

import type { ComponentNode } from '../../component-graph';
import type { ComponentIdentity } from '../../component-identity';
import type { ComponentUsageWithIdentity } from '../../cross-file-usage';

// ========================================
// CONFIGURATION
// ========================================

/**
 * Minimal space scale for testing
 * Each value represents a quantum of spacing
 */
export const testSpace = {
  m: { property: 'margin', scale: 'space' },
  mx: {
    properties: ['marginLeft', 'marginRight'],
    scale: 'space',
  },
  my: {
    properties: ['marginTop', 'marginBottom'],
    scale: 'space',
  },
  mt: { property: 'marginTop', scale: 'space' },
  mb: { property: 'marginBottom', scale: 'space' },
  mr: { property: 'marginRight', scale: 'space' },
  ml: { property: 'marginLeft', scale: 'space' },
  p: { property: 'padding', scale: 'space' },
  px: {
    properties: ['paddingLeft', 'paddingRight'],
    scale: 'space',
  },
  py: {
    properties: ['paddingTop', 'paddingBottom'],
    scale: 'space',
  },
  pt: { property: 'paddingTop', scale: 'space' },
  pb: { property: 'paddingBottom', scale: 'space' },
  pr: { property: 'paddingRight', scale: 'space' },
  pl: { property: 'paddingLeft', scale: 'space' },
  gap: { property: 'gap', scale: 'space' },
} as const;

/**
 * Minimal color scale for testing
 */
export const testColor = {
  color: { property: 'color', scale: 'colors' },
  bg: { property: 'backgroundColor', scale: 'colors' },
  fill: { property: 'fill', scale: 'colors' },
  stroke: { property: 'stroke', scale: 'colors' },
} as const;

/**
 * Minimal typography for testing
 */
export const testTypography = {
  fontSize: { property: 'fontSize', scale: 'fontSizes' },
  fontWeight: { property: 'fontWeight', scale: 'fontWeights' },
  lineHeight: { property: 'lineHeight', scale: 'lineHeights' },
  letterSpacing: { property: 'letterSpacing', scale: 'letterSpacings' },
} as const;

/**
 * Additional test shorthands
 */
export const testShorthands = {
  size: {
    properties: ['width', 'height'],
  },
  area: {
    property: 'gridArea',
  },
  inset: {
    properties: ['top', 'right', 'bottom', 'left'],
  },
} as const;

/**
 * Minimal theme for testing
 * Values exist in discrete quantum states
 */
export const testTheme = {
  space: {
    0: 0,
    1: '4px',
    2: '8px',
    3: '16px',
    4: '24px',
    5: '32px',
    6: '48px',
    // Numeric values for testing scale lookups
    10: '10px',
    20: '20px',
    30: '30px',
    40: '40px',
  },
  colors: {
    primary: '#007bff',
    secondary: '#6c757d',
    white: '#ffffff',
    black: '#000000',
    // Nested values for testing
    text: {
      primary: '#212529',
      secondary: '#6c757d',
      muted: '#adb5bd',
    },
    surface: {
      primary: '#ffffff',
      secondary: '#f8f9fa',
      elevated: 'rgba(255, 255, 255, 0.95)',
    },
  },
  fontSizes: {
    sm: '14px',
    md: '16px',
    lg: '20px',
    xl: '24px',
    // Numeric references
    12: '12px',
    14: '14px',
    16: '16px',
    18: '18px',
  },
  fontWeights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
  letterSpacings: {
    tight: '-0.05em',
    normal: '0',
    wide: '0.05em',
  },
  shadows: {
    sm: '0 1px 2px rgba(0,0,0,0.05)',
    md: '0 4px 6px rgba(0,0,0,0.1)',
    lg: '0 10px 15px rgba(0,0,0,0.1)',
  },
  gradients: {
    primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    flowX: 'linear-gradient(90deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
  },
  // Breakpoints for responsive testing
  breakpoints: {
    xs: '0px',
    sm: '576px',
    md: '768px',
    lg: '992px',
    xl: '1200px',
  },
} as const;

/**
 * Extended theme for complex scenarios
 */
export const complexTestTheme = {
  ...testTheme,
  // Additional scales for edge cases
  borders: {
    none: 'none',
    thin: '1px solid',
    thick: '2px solid',
  },
  radii: {
    none: '0',
    sm: '2px',
    md: '4px',
    lg: '8px',
    full: '9999px',
  },
  transitions: {
    fast: 'all 0.15s ease',
    normal: 'all 0.3s ease',
    slow: 'all 0.5s ease',
  },
} as const;

/**
 * Group definitions for testing
 */
export const testGroups = {
  space: testSpace,
  color: testColor,
  typography: testTypography,
  layout: {
    display: { property: 'display' },
    position: { property: 'position' },
    ...testShorthands,
  },
} as const;

/**
 * Generator options for tests
 */
export const testGeneratorOptions = {
  minimal: { atomic: false },
  atomic: { atomic: true },
  prefixed: { atomic: false, prefix: 'animus' },
  hybrid: { themeResolution: { mode: 'hybrid' as const } },
} as const;

// Legacy aliases for backward compatibility
export const quantumTheme = testTheme;
export const quantumSpace = testSpace;
export const quantumColor = testColor;
export const quantumTypography = testTypography;
export const quantumShorthands = testShorthands;
export const quantumGroups = testGroups;
export const quantumGeneratorOptions = testGeneratorOptions;
export const complexQuantumTheme = complexTestTheme;

// ========================================
// CORE UTILITIES
// ========================================

/**
 * Test Universe - A complete isolated environment for testing
 */
export interface TestUniverse {
  tempDir: string;
  createFile: (filename: string, content: string) => string;
  createProgram: (files?: string[]) => ts.Program;
  cleanup: () => void;
}

/**
 * Creates an isolated test universe with file system and TypeScript compiler
 */
export function createTestUniverse(name: string): TestUniverse {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `animus-test-${name}-`)
  );

  const createFile = (filename: string, content: string): string => {
    const filePath = path.join(tempDir, filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content);
    return filePath;
  };

  const createProgram = (files?: string[]): ts.Program => {
    const targetFiles =
      files ||
      fs
        .readdirSync(tempDir)
        .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
        .map((f) => path.join(tempDir, f));

    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      baseUrl: tempDir,
    };

    return ts.createProgram(targetFiles, options);
  };

  const cleanup = () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  return {
    tempDir,
    createFile,
    createProgram,
    cleanup,
  };
}

/**
 * Standard TypeScript config creation
 */
export function createTsConfig(
  dir: string,
  options?: Partial<ts.CompilerOptions>
): void {
  const tsconfig = {
    compilerOptions: {
      target: 'es2020',
      module: 'esnext',
      jsx: 'react',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      moduleResolution: 'node',
      ...options,
    },
  };

  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2)
  );
}

/**
 * Setup/teardown helpers for common test patterns
 */
export function setupTestUniverse(testName: string) {
  let universe: TestUniverse;

  beforeEach(() => {
    universe = createTestUniverse(testName);
  });

  afterEach(() => {
    universe.cleanup();
  });

  return () => universe;
}

// ========================================
// MOCK FACTORIES
// ========================================

/**
 * Mock factory functions for data structures
 */
export const MockFactories = {
  componentNode: (name: string, filePath?: string) => ({
    identity: {
      name,
      filePath: filePath || `/test/components/${name}.tsx`,
      exportName: name,
      hash: `hash-${name}`,
    },
    allVariants: {
      size: {
        prop: 'size',
        values: new Set(['small', 'medium', 'large']),
        defaultValue: 'medium',
      },
    },
    allStates: new Set(['hover', 'focus', 'disabled']),
    allProps: {},
    groups: [],
    extends: undefined,
    extraction: {
      styles: { padding: '8px 16px' },
      element: 'button',
    },
    metadata: {
      id: `${name}-id`,
      className: `${name}-class`,
      elementType: 'button',
    },
  }),

  componentGraph: (nodes: number = 3) => {
    const components = new Map();
    for (let i = 0; i < nodes; i++) {
      const name = `Component${i}`;
      components.set(`hash-${name}`, MockFactories.componentNode(name));
    }

    return {
      components,
      metadata: {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        rootDirectory: '/test',
        totalComponents: nodes,
        totalFiles: nodes,
      },
    };
  },

  resolutionMap: () =>
    new Map([
      ['./Button', '/test/components/Button.tsx'],
      ['./Card', '/test/components/Card.tsx'],
      ['@components/Text', '/test/components/Text.tsx'],
    ]),

  globalUsageMap: (
    components: Array<{
      identity: ComponentIdentity;
      usages: Array<{
        componentName: string;
        props: Record<string, any>;
        location: string;
      }>;
    }>
  ) => {
    const map = new Map();

    for (const component of components) {
      const propValueSets = new Map<string, Set<string>>();

      // Aggregate prop values from all usages
      for (const usage of component.usages) {
        for (const [prop, value] of Object.entries(usage.props)) {
          if (!propValueSets.has(prop)) {
            propValueSets.set(prop, new Set());
          }

          // Handle different value types
          if (Array.isArray(value)) {
            // Responsive array
            value.forEach((v, i) => {
              if (v !== undefined) {
                const breakpoint = ['_', 'sm', 'md', 'lg', 'xl'][i] || '_';
                propValueSets.get(prop)!.add(`${v}:${breakpoint}`);
              }
            });
          } else if (typeof value === 'object' && value !== null) {
            // Responsive object
            for (const [bp, v] of Object.entries(value)) {
              propValueSets.get(prop)!.add(`${v}:${bp}`);
            }
          } else {
            // Simple value
            propValueSets.get(prop)!.add(`${value}:_`);
          }
        }
      }

      map.set(component.identity.hash, {
        identity: component.identity,
        usages: component.usages.map((u) => ({
          ...u,
          identity: component.identity,
          usageLocation: u.location,
        })),
        propValueSets,
      });
    }

    return map;
  },

  languageService: (files: Record<string, string>): ts.LanguageService => {
    const serviceHost: ts.LanguageServiceHost = {
      getScriptFileNames: () => Object.keys(files),
      getScriptVersion: () => '1',
      getScriptSnapshot: (fileName) => {
        const content = files[fileName];
        if (!content) return undefined;
        return ts.ScriptSnapshot.fromString(content);
      },
      getCurrentDirectory: () => '/',
      getCompilationSettings: () => ({
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.React,
      }),
      getDefaultLibFileName: () => 'lib.d.ts',
      fileExists: (path) => path in files,
      readFile: (path) => files[path],
      readDirectory: () => [],
    };

    return ts.createLanguageService(serviceHost);
  },
};

// ========================================
// TEST COMPONENTS
// ========================================

/**
 * Component code templates for common test scenarios
 */
export const TestComponents = {
  simple: (name: string) => `
import { animus } from '@animus/core';

export const ${name} = animus
  .styles({
    padding: '8px 16px',
    backgroundColor: 'blue',
  })
  .asElement('button');
`,

  withVariants: (name: string) => `
import { animus } from '@animus/core';

export const ${name} = animus
  .styles({
    padding: '8px 16px',
  })
  .variant('size', {
    small: { fontSize: '12px' },
    medium: { fontSize: '14px' },
    large: { fontSize: '16px' },
  })
  .defaultVariant({ size: 'medium' })
  .asElement('button');
`,

  withStates: (name: string) => `
import { animus } from '@animus/core';

export const ${name} = animus
  .styles({
    padding: '8px 16px',
  })
  .states({
    hover: { backgroundColor: 'lightblue' },
    focus: { outline: '2px solid blue' },
    disabled: { opacity: 0.5 },
  })
  .asElement('button');
`,

  extended: (baseName: string, newName: string) => `
import { ${baseName} } from './${baseName}';

export const ${newName} = ${baseName}
  .extend()
  .styles({
    backgroundColor: 'red',
  })
  .asElement('button');
`,

  jsxUsage: (components: string[]) => `
import React from 'react';
${components.map((c) => `import { ${c} } from './${c}';`).join('\n')}

export function App() {
  return (
    <div>
      ${components.map((c) => `<${c}>Click me</${c}>`).join('\n      ')}
    </div>
  );
}
`,

  // Evolution patterns from quantum fixtures
  evolvingButton: () => [
    // Stage 1: Basic button
    `export const Button = animus.styles({ padding: '8px' }).asElement('button');`,

    // Stage 2: Add variants
    `export const Button = animus
      .styles({ padding: '8px' })
      .variant('size', {
        small: { fontSize: '12px' },
        large: { fontSize: '16px' }
      })
      .asElement('button');`,

    // Stage 3: Add states
    `export const Button = animus
      .styles({ padding: '8px' })
      .variant('size', {
        small: { fontSize: '12px' },
        large: { fontSize: '16px' }
      })
      .states({
        hover: { backgroundColor: 'blue' },
        disabled: { opacity: 0.5 }
      })
      .asElement('button');`,
  ],

  componentMitosis: () => ({
    before: `
      export const Card = animus
        .styles({
          padding: '16px',
          border: '1px solid gray',
        })
        .variant('type', {
          info: { backgroundColor: 'lightblue' },
          warning: { backgroundColor: 'lightyellow' },
          error: { backgroundColor: 'lightcoral' },
        })
        .asElement('div');
    `,
    after: {
      'Card.tsx': `
        export const Card = animus
          .styles({
            padding: '16px',
            border: '1px solid gray',
          })
          .asElement('div');
      `,
      'InfoCard.tsx': `
        import { Card } from './Card';
        export const InfoCard = Card.extend()
          .styles({ backgroundColor: 'lightblue' })
          .asElement('div');
      `,
      'WarningCard.tsx': `
        import { Card } from './Card';
        export const WarningCard = Card.extend()
          .styles({ backgroundColor: 'lightyellow' })
          .asElement('div');
      `,
      'ErrorCard.tsx': `
        import { Card } from './Card';
        export const ErrorCard = Card.extend()
          .styles({ backgroundColor: 'lightcoral' })
          .asElement('div');
      `,
    },
  }),
};

// ========================================
// ASSERTIONS
// ========================================

/**
 * Common assertion helpers
 */
export const Assertions = {
  expectValidComponentIdentity: (identity: any) => {
    expect(identity).toMatchObject({
      name: expect.any(String),
      filePath: expect.any(String),
      exportName: expect.any(String),
    });
    expect(identity.hash).toBeDefined();
    expect(identity.hash).toHaveLength(8);
  },

  expectComponentsEqual: (a: any, b: any) => {
    expect(a.name).toBe(b.name);
    expect(a.filePath).toBe(b.filePath);
    expect(a.exportName).toBe(b.exportName);
    expect(a.hash).toBe(b.hash);
  },

  expectNoErrors: (diagnostics: readonly ts.Diagnostic[]) => {
    const errors = diagnostics.filter(
      (d) => d.category === ts.DiagnosticCategory.Error
    );
    if (errors.length > 0) {
      const messages = errors.map((e) =>
        ts.flattenDiagnosticMessageText(e.messageText, '\n')
      );
      throw new Error(`TypeScript compilation errors:\n${messages.join('\n')}`);
    }
  },

  // Quantum assertions
  assertQuantumStability: (
    realityComponent: ComponentNode | undefined,
    possibilityComponent: ComponentNode | undefined
  ) => {
    if (realityComponent && possibilityComponent) {
      expect(realityComponent.identity.hash).toBe(
        possibilityComponent.identity.hash
      );
      expect(realityComponent.identity.name).toBe(
        possibilityComponent.identity.name
      );
    }
  },

  assertExtensionRelationship: (
    child: ComponentNode,
    parent: ComponentNode
  ) => {
    expect(child.extends?.hash).toBe(parent.identity.hash);
    expect(child.extends?.name).toBe(parent.identity.name);
  },

  assertComponentUsage: (
    usageMap: Map<
      string,
      {
        identity: ComponentIdentity;
        usages: ComponentUsageWithIdentity[];
        propValueSets: Map<string, Set<string>>;
      }
    >,
    componentHash: string,
    expectations: {
      usageCount?: number;
      propValues?: Record<string, string[]>;
      usageLocations?: string[];
    }
  ) => {
    const usage = usageMap.get(componentHash);
    expect(usage).toBeDefined();

    if (expectations.usageCount !== undefined) {
      expect(usage!.usages.length).toBe(expectations.usageCount);
    }

    if (expectations.propValues) {
      for (const [prop, expectedValues] of Object.entries(
        expectations.propValues
      )) {
        const actualValues = Array.from(
          usage!.propValueSets.get(prop) || new Set()
        );
        expect(actualValues).toEqual(expect.arrayContaining(expectedValues));
      }
    }

    if (expectations.usageLocations) {
      const actualLocations = usage!.usages.map((u) => u.usageLocation);
      expect(actualLocations).toEqual(
        expect.arrayContaining(expectations.usageLocations)
      );
    }
  },

  assertObservationInvariance: <T>(unobserved: () => T, observed: () => T) => {
    const result1 = unobserved();
    const result2 = observed();
    expect(result1).toEqual(result2);
  },
};

// ========================================
// EDGE CASES & SCENARIOS
// ========================================

/**
 * Edge Case Generators - Create problematic scenarios
 */
export const EdgeCases = {
  /**
   * Generate deeply nested component extensions
   */
  deepInheritance: (depth: number) => {
    const files: Record<string, string> = {};

    files['Base.tsx'] = `
      export const Base = animus
        .styles({ padding: '1px' })
        .asElement('div');
    `;

    for (let i = 1; i <= depth; i++) {
      const prevName = i === 1 ? 'Base' : `Level${i - 1}`;
      files[`Level${i}.tsx`] = `
        import { ${prevName} } from './${prevName}';
        export const Level${i} = ${prevName}.extend()
          .styles({ padding: '${i + 1}px' })
          .asElement('div');
      `;
    }

    return files;
  },

  /**
   * Generate circular dependencies
   */
  circularDependencies: (nodeCount: number) => {
    const files: Record<string, string> = {};

    for (let i = 0; i < nodeCount; i++) {
      const next = (i + 1) % nodeCount;
      files[`Component${i}.tsx`] = `
        import { Component${next} } from './Component${next}';
        export const Component${i} = animus
          .styles({ order: ${i} })
          .asElement('div');

        // Reference to create circular dependency
        export const Extended${i} = Component${next}.extend();
      `;
    }

    return files;
  },

  /**
   * Generate components with name collisions
   */
  nameCollisions: () => ({
    'components/Button.tsx': `
      export const Button = animus.styles({ color: 'blue' }).asElement('button');
    `,
    'ui/Button.tsx': `
      export const Button = animus.styles({ color: 'red' }).asElement('button');
    `,
    'shared/Button.tsx': `
      export const Button = animus.styles({ color: 'green' }).asElement('button');
      export { Button as SharedButton };
    `,
    'App.tsx': `
      import { Button as ComponentButton } from './components/Button';
      import { Button as UIButton } from './ui/Button';
      import { SharedButton } from './shared/Button';

      export function App() {
        return (
          <div>
            <ComponentButton>Component</ComponentButton>
            <UIButton>UI</UIButton>
            <SharedButton>Shared</SharedButton>
          </div>
        );
      }
    `,
  }),

  /**
   * Generate components with complex prop spreading
   */
  propSpreading: () => `
    const baseProps = { size: 'medium', variant: 'primary' };
    const overrides = { variant: 'secondary', disabled: true };

    export function ComplexComponent() {
      return (
        <>
          <Button {...baseProps} />
          <Button {...baseProps} {...overrides} />
          <Button {...{ ...baseProps, ...overrides, size: 'large' }} />
        </>
      );
    }
  `,

  /**
   * Generate components with responsive props
   */
  responsiveProps: () => `
    import { Box, Text, Grid } from './components';

    export function ResponsiveLayout() {
      return (
        <Box p={[2, 4, 6]} m={{ _: 0, sm: 2, md: 4 }}>
          <Grid columns={[1, 2, 3]} gap={['1rem', '2rem']}>
            <Text fontSize={['14px', '16px', '18px']}>
              Responsive text
            </Text>
          </Grid>
        </Box>
      );
    }
  `,

  /**
   * Generate components using theme scales
   */
  themeScaleUsage: () => `
    import { Button, Box, Text } from './components';

    export function ThemedComponent() {
      return (
        <Box bg="primary" color="text.primary" p="space.md">
          <Button variant="solid" colorScheme="brand">
            <Text fontSize="sizes.body" fontWeight="weights.bold">
              Click me
            </Text>
          </Button>
        </Box>
      );
    }
  `,

  /**
   * Generate compound variants usage
   */
  compoundVariants: () => `
    import { Card } from './components';

    export function CompoundVariantTest() {
      return (
        <>
          <Card size="small" variant="elevated" />
          <Card size="large" variant="bordered" state="selected" />
          <Card size="medium" variant="flat" colorScheme="danger" />
        </>
      );
    }
  `,
};

export const PerformanceScenarios = {
  /**
   * Generate a large number of simple components
   */
  manyComponents: (count: number): Record<string, string> => {
    const files: Record<string, string> = {};

    for (let i = 0; i < count; i++) {
      files[`Component${i}.tsx`] = `
        export const Component${i} = animus
          .styles({
            padding: '${i % 10}px',
            margin: '${i % 5}px',
            fontSize: '${12 + (i % 8)}px',
          })
          .asElement('div');
      `;
    }

    return files;
  },

  /**
   * Generate components with many variants
   */
  manyVariants: (variantCount: number) => `
    export const MegaButton = animus
      .styles({ padding: '8px' })
      ${Array.from(
        { length: variantCount },
        (_, i) => `
      .variant('variant${i}', {
        option1: { property${i}: 'value1' },
        option2: { property${i}: 'value2' },
        option3: { property${i}: 'value3' },
      })`
      ).join('')}
      .asElement('button');
  `,

  /**
   * Generate a complex component graph
   */
  complexGraph: (
    layers: number,
    nodesPerLayer: number
  ): Record<string, string> => {
    const files: Record<string, string> = {};

    // Base layer
    for (let i = 0; i < nodesPerLayer; i++) {
      files[`Layer0_Component${i}.tsx`] = `
        export const Layer0_Component${i} = animus
          .styles({ layer: 0, index: ${i} })
          .asElement('div');
      `;
    }

    // Subsequent layers extend from previous layer
    for (let layer = 1; layer < layers; layer++) {
      for (let i = 0; i < nodesPerLayer; i++) {
        const imports = Array.from({ length: 2 }, (_, j) => {
          const prevIndex = (i + j) % nodesPerLayer;
          return `import { Layer${layer - 1}_Component${prevIndex} } from './Layer${layer - 1}_Component${prevIndex}';`;
        }).join('\n');

        files[`Layer${layer}_Component${i}.tsx`] = `
          ${imports}

          export const Layer${layer}_Component${i} = Layer${layer - 1}_Component${i % nodesPerLayer}
            .extend()
            .styles({ layer: ${layer}, index: ${i} })
            .asElement('div');
        `;
      }
    }

    return files;
  },
};

// ========================================
// ERROR SCENARIOS
// ========================================

/**
 * Error simulation helpers
 */
export const ErrorScenarios = {
  corruptTypeScript: () => `
    export const Button = animus.
    // Syntax error - incomplete expression
  `,

  circularDependency: () => ({
    'A.tsx': `import { B } from './B'; export const A = B.extend();`,
    'B.tsx': `import { A } from './A'; export const B = A.extend();`,
  }),

  missingImport: () => `
    import { NonExistent } from './nowhere';
    export const Button = NonExistent.extend();
  `,

  malformedJSON: () => '{ invalid json',
};

// ========================================
// ADVANCED FEATURES
// ========================================

// ========================================
// HELPERS
// ========================================

/**
 * Vitest mock helpers
 */
export const VitestHelpers = {
  mockConsole: () => {
    const originalConsole = { ...console };

    beforeEach(() => {
      console.log = vi.fn();
      console.error = vi.fn();
      console.warn = vi.fn();
    });

    afterEach(() => {
      console.log = originalConsole.log;
      console.error = originalConsole.error;
      console.warn = originalConsole.warn;
    });

    return {
      expectLogged: (message: string) => {
        expect((console as any).log).toHaveBeenCalledWith(
          expect.stringContaining(message)
        );
      },
      expectErrored: (message: string) => {
        expect((console as any).error).toHaveBeenCalledWith(
          expect.stringContaining(message)
        );
      },
    };
  },
};

/**
 * Performance testing helpers
 */
export function measurePerformance<T>(
  _name: string,
  fn: () => T,
  options: { warmup?: number; iterations?: number } = {}
): { result: T; avgTime: number; times: number[] } {
  const { warmup = 3, iterations = 10 } = options;

  // Warmup runs
  for (let i = 0; i < warmup; i++) {
    fn();
  }

  // Measured runs
  const times: number[] = [];
  let result: T;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    result = fn();
    const end = performance.now();
    times.push(end - start);
  }

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

  return { result: result!, avgTime, times };
}

// Type exports for convenience
export type TestTheme = typeof testTheme;
export type ComplexTestTheme = typeof complexTestTheme;
export type TestGroups = typeof testGroups;
export type TestGeneratorOptions = typeof testGeneratorOptions;

// Legacy type exports
export type QuantumTheme = TestTheme;
export type ComplexQuantumTheme = ComplexTestTheme;
export type QuantumGroups = TestGroups;
export type QuantumGeneratorOptions = TestGeneratorOptions;

// Re-export legacy names from quantum fixtures
export const ComponentEvolution = TestComponents;
export const EdgeCaseGenerators = EdgeCases;
export const QuantumAssertions = Assertions;

// ========================================
// PHASE 3B UTILITIES
// ========================================

export * from './css-helpers';
// export * from './mock-builders';
// Export new utilities for Phase 3B migration
export * from './virtual-program';

// The utilities are unified
// Tests can now import from a single source
