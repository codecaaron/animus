# Feature: Test Infrastructure and Helpers

## Problem Statement
- Testing static extraction features involves significant boilerplate
- Common patterns are repeated across test files (creating TS programs, parsing code, etc.)
- Test assertions are verbose and hard to read
- Snapshot testing needs better organization
- Mock data creation is tedious and error-prone
- Testing cross-cutting concerns (like dynamic detection) requires complex setup

Which of the remaining features does this implement?
- [ ] Cross-file component usage tracking
- [ ] Deep theme resolution
- [ ] Full variant/state processing
- [ ] Multi-file scope analysis
- [x] Core infrastructure feature (testing support)

## Phase Analysis
- Primary phase affected: All phases (cross-cutting testing concern)
- Secondary phases impacted: None
- Why: Testing infrastructure supports all feature development

## Test Helper Categories

### 1. Code Creation Helpers
```typescript
// test-utils/builders.ts

// Simple component builders
export const component = {
  basic: (name = 'Button') => `
    const ${name} = animus
      .styles({ padding: '8px' })
      .asElement('button');
  `,
  
  withVariants: (name = 'Button', variants = { size: { sm: {}, lg: {} } }) => `
    const ${name} = animus
      .styles({ padding: '8px' })
      .variant({
        prop: 'size',
        variants: ${JSON.stringify(variants)}
      })
      .asElement('button');
  `,
  
  withStates: (name = 'Button', states = { disabled: { opacity: 0.5 } }) => `
    const ${name} = animus
      .styles({ padding: '8px' })
      .states(${JSON.stringify(states)})
      .asElement('button');
  `,
  
  withProps: (name = 'Box', groups = ['space', 'color']) => `
    const ${name} = animus
      .groups({ ${groups.map(g => `${g}: true`).join(', ')} })
      .asElement('div');
  `,
  
  complex: (config: ComponentConfig) => {
    // Build complex components with all features
  }
};

// Usage pattern builders
export const usage = {
  basic: (component = 'Button', props = {}) => 
    `<${component} ${Object.entries(props).map(([k, v]) => `${k}="${v}"`).join(' ')} />`,
  
  withChildren: (component = 'Button', props = {}, children = 'Click me') =>
    `<${component} ${Object.entries(props).map(([k, v]) => `${k}="${v}"`).join(' ')}>${children}</${component}>`,
  
  withSpread: (component = 'Button', spread = 'props') =>
    `<${component} {...${spread}} />`,
  
  withDynamic: (component = 'Button', prop: string, expr: string) =>
    `<${component} ${prop}={${expr}} />`
};

// File builders
export const file = {
  single: (componentCode: string, usageCode?: string) => `
    import { animus } from '@animus-ui/core';
    
    ${componentCode}
    
    ${usageCode ? `export const App = () => ${usageCode};` : ''}
  `,
  
  withImports: (imports: string[], componentCode: string) => `
    ${imports.join('\n')}
    
    ${componentCode}
  `,
  
  multiComponent: (...components: string[]) => `
    import { animus } from '@animus-ui/core';
    
    ${components.join('\n\n')}
  `
};
```

### 2. TypeScript Program Helpers
```typescript
// test-utils/typescript.ts

export class TestProgram {
  private program: ts.Program;
  private sourceFile: ts.SourceFile;
  
  constructor(code: string, fileName = 'test.tsx') {
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      lib: ['es2020', 'dom']
    };
    
    // Create in-memory source file
    this.sourceFile = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.ESNext,
      true
    );
    
    // Create program
    const compilerHost = this.createInMemoryCompilerHost(
      { [fileName]: code },
      compilerOptions
    );
    
    this.program = ts.createProgram(
      [fileName],
      compilerOptions,
      compilerHost
    );
  }
  
  get typeChecker() {
    return this.program.getTypeChecker();
  }
  
  get source() {
    return this.sourceFile;
  }
  
  findNode<T extends ts.Node>(
    predicate: (node: ts.Node) => node is T
  ): T | undefined {
    let result: T | undefined;
    
    const visit = (node: ts.Node) => {
      if (predicate(node)) {
        result = node;
        return;
      }
      ts.forEachChild(node, visit);
    };
    
    visit(this.sourceFile);
    return result;
  }
  
  findAllNodes<T extends ts.Node>(
    predicate: (node: ts.Node) => node is T
  ): T[] {
    const results: T[] = [];
    
    const visit = (node: ts.Node) => {
      if (predicate(node)) {
        results.push(node);
      }
      ts.forEachChild(node, visit);
    };
    
    visit(this.sourceFile);
    return results;
  }
}

// Quick creation function
export function createTestProgram(code: string): TestProgram {
  return new TestProgram(code);
}
```

### 3. Extraction Test Helpers
```typescript
// test-utils/extraction.ts

export class ExtractionTestHarness {
  private extractor: StaticExtractor;
  private program: TestProgram;
  
  constructor(code: string, config?: Partial<ExtractorConfig>) {
    this.program = new TestProgram(code);
    this.extractor = createStaticExtractor({
      ...getDefaultConfig(),
      ...config
    });
  }
  
  // Extract with automatic context setup
  extract(): ExtractionResult {
    return this.extractor.extractFile('test.tsx');
  }
  
  // Extract specific phase
  extractPhase<T>(phase: ExtractionPhase): T {
    const context = this.createContext();
    const phaseImpl = this.getPhase(phase);
    return phaseImpl.execute(context, this.getPhaseInput(phase));
  }
  
  // Extract and get specific data
  extractComponents(): ComponentDefinition[] {
    const result = this.extract();
    return Array.from(result.components.values());
  }
  
  extractUsages(): ComponentUsage[] {
    const result = this.extract();
    return result.usages;
  }
  
  extractClasses(): { atomic: string[], component: StyleClass[] } {
    const result = this.extract();
    return {
      atomic: result.atomicClasses,
      component: result.componentClasses
    };
  }
  
  extractDynamicUsages(): DynamicUsageInfo[] {
    const result = this.extract();
    return result.dynamicUsages;
  }
}

// Quick extraction
export function extract(code: string, config?: Partial<ExtractorConfig>) {
  return new ExtractionTestHarness(code, config).extract();
}

// Phase-specific extractors
export const extractPhase = {
  discovery: (code: string) => 
    new ExtractionTestHarness(code).extractPhase<TerminalDiscoveryOutput>('discovery'),
  
  reconstruction: (code: string) =>
    new ExtractionTestHarness(code).extractPhase<ChainReconstructionOutput>('reconstruction'),
  
  collection: (code: string) =>
    new ExtractionTestHarness(code).extractPhase<UsageCollectionOutput>('collection'),
  
  computation: (code: string) =>
    new ExtractionTestHarness(code).extractPhase<AtomicComputationOutput>('computation')
};
```

### 4. Assertion Helpers
```typescript
// test-utils/assertions.ts

// Component assertions
export const expectComponent = (component: ComponentDefinition) => ({
  toHaveStyles: (expected: Partial<StyleObject>) => {
    expect(component.baseStyles).toMatchObject(expected);
  },
  
  toHaveVariant: (prop: string, variants: Record<string, any>) => {
    const variant = component.variantAnalysis?.variants.find(v => v.prop === prop);
    expect(variant).toBeDefined();
    expect(variant!.variants).toMatchObject(variants);
  },
  
  toHaveStates: (states: string[]) => {
    const definedStates = Object.keys(component.variantAnalysis?.states || {});
    expect(definedStates).toEqual(expect.arrayContaining(states));
  },
  
  toHaveGroups: (groups: string[]) => {
    expect(component.enabledGroups).toEqual(expect.arrayContaining(groups));
  }
});

// Usage assertions
export const expectUsage = (usage: ComponentUsage) => ({
  toHaveProps: (props: Record<string, any>) => {
    expect(usage.props).toMatchObject(props);
  },
  
  toHaveVariantProps: (props: Record<string, string>) => {
    expect(usage.variantProps).toMatchObject(props);
  },
  
  toHaveActiveStates: (states: string[]) => {
    expect(usage.activeStates).toEqual(expect.arrayContaining(states));
  },
  
  toBeDynamic: (type?: 'variants' | 'states' | 'utilities') => {
    expect(usage.dynamicProps).toBeDefined();
    if (type) {
      expect(usage.dynamicProps![type]).toBeDefined();
    }
  }
});

// Class assertions
export const expectClasses = (classes: { atomic: string[], component: StyleClass[] }) => ({
  toHaveAtomicClass: (className: string) => {
    expect(classes.atomic).toContain(className);
  },
  
  toHaveComponentClass: (predicate: (c: StyleClass) => boolean) => {
    expect(classes.component.some(predicate)).toBe(true);
  },
  
  toGenerateCSS: (expected: string) => {
    const css = generateCSS(classes);
    expect(css).toContain(expected);
  }
});

// Dynamic usage assertions
export const expectDynamic = (usages: DynamicUsageInfo[]) => ({
  toHaveCount: (count: number) => {
    expect(usages).toHaveLength(count);
  },
  
  toInclude: (componentId: string, reason: DynamicReason) => {
    expect(usages.some(u => 
      u.componentId === componentId && 
      u.reason === reason
    )).toBe(true);
  }
});
```

### 5. Snapshot Helpers
```typescript
// test-utils/snapshots.ts

export class SnapshotHelper {
  static formatComponent(component: ComponentDefinition): string {
    return `
Component: ${component.componentName}
ID: ${component.componentId}

Base Styles:
${this.formatStyles(component.baseStyles)}

Variants:
${this.formatVariants(component.variantAnalysis?.variants || [])}

States:
${this.formatStates(component.variantAnalysis?.states || {})}

Groups: ${component.enabledGroups?.join(', ') || 'none'}
`;
  }
  
  static formatCSS(classes: StyleClass[]): string {
    return classes
      .map(c => `/* ${c.type}: ${c.className} */\n${generateCSS(c)}`)
      .join('\n\n');
  }
  
  static formatExtractionResult(result: ExtractionResult): string {
    return `
=== EXTRACTION RESULT ===

Components (${result.components.size}):
${Array.from(result.components.values()).map(c => this.formatComponent(c)).join('\n---\n')}

Atomic Classes (${result.atomicClasses.length}):
${result.atomicClasses.join(', ')}

Dynamic Usages (${result.dynamicUsages.length}):
${result.dynamicUsages.map(d => `- ${d.componentId}: ${d.reason}`).join('\n')}

Generated CSS:
${this.formatCSS(result.componentClasses)}
`;
  }
}

// Jest snapshot serializer
export const extractionSerializer = {
  test: (val: any) => val && val.__type === 'ExtractionResult',
  print: (val: ExtractionResult) => SnapshotHelper.formatExtractionResult(val)
};
```

### 6. Mock Data Helpers
```typescript
// test-utils/mocks.ts

export const mockPropRegistry = (): PropRegistry => ({
  // Space
  p: { property: 'padding', scale: 'space' },
  m: { property: 'margin', scale: 'space' },
  px: { property: ['paddingLeft', 'paddingRight'], scale: 'space' },
  py: { property: ['paddingTop', 'paddingBottom'], scale: 'space' },
  
  // Color
  color: { property: 'color', scale: 'colors' },
  bg: { property: 'backgroundColor', scale: 'colors' },
  
  // Layout
  display: { property: 'display' },
  width: { property: 'width', scale: 'sizes' },
  height: { property: 'height', scale: 'sizes' }
});

export const mockTheme = () => ({
  colors: {
    primary: '#0066cc',
    secondary: '#6c757d',
    text: '#333333',
    background: '#ffffff'
  },
  space: {
    0: '0',
    1: '0.25rem',
    2: '0.5rem',
    3: '0.75rem',
    4: '1rem',
    8: '2rem'
  },
  sizes: {
    full: '100%',
    half: '50%',
    0: '0',
    1: '0.25rem'
  }
});

export const mockComponentDefinition = (
  overrides: Partial<ComponentDefinition> = {}
): ComponentDefinition => ({
  componentId: 'Button-abc123',
  componentName: 'Button',
  elementType: 'button',
  baseStyles: { padding: '8px 16px' },
  variantAnalysis: {
    variants: [],
    states: {},
    hasDefaultVariant: false
  },
  enabledGroups: [],
  ...overrides
});
```

### 7. Integration Test Helpers
```typescript
// test-utils/integration.ts

export class IntegrationTest {
  static fullFlow(componentCode: string, usageCode: string) {
    const code = file.single(componentCode, usageCode);
    const harness = new ExtractionTestHarness(code);
    
    return {
      result: harness.extract(),
      
      // Chainable assertions
      expectComponent: (name: string) => {
        const component = harness.extractComponents()
          .find(c => c.componentName === name);
        expect(component).toBeDefined();
        return expectComponent(component!);
      },
      
      expectUsage: (index = 0) => {
        const usages = harness.extractUsages();
        expect(usages.length).toBeGreaterThan(index);
        return expectUsage(usages[index]);
      },
      
      expectCSS: () => {
        const classes = harness.extractClasses();
        return expectClasses(classes);
      },
      
      expectNoDynamicUsage: () => {
        const dynamic = harness.extractDynamicUsages();
        expect(dynamic).toHaveLength(0);
      }
    };
  }
  
  static multiFile(files: Record<string, string>) {
    // Test cross-file scenarios
  }
}

// Usage example:
// IntegrationTest
//   .fullFlow(
//     component.withVariants('Button'),
//     usage.basic('Button', { size: 'small' })
//   )
//   .expectComponent('Button')
//   .toHaveVariant('size', { small: {}, large: {} })
//   .expectUsage()
//   .toHaveVariantProps({ size: 'small' })
//   .expectCSS()
//   .toHaveComponentClass(c => c.className.includes('size-small'));
```

## Test Structure Guidelines

### 1. Test File Organization
```typescript
// __tests__/features/variants.test.ts
import { component, usage, extract, expectComponent } from '@test-utils';

describe('Variant Processing', () => {
  describe('single variant', () => {
    it('should extract variant definition', () => {
      const result = extract(
        component.withVariants('Button', {
          size: { small: { padding: '4px' }, large: { padding: '8px' } }
        })
      );
      
      expectComponent(result.components.get('Button-*')!)
        .toHaveVariant('size', {
          small: { padding: '4px' },
          large: { padding: '8px' }
        });
    });
  });
});
```

### 2. Snapshot Testing
```typescript
// __tests__/snapshots/complex-components.test.ts
import { SnapshotHelper } from '@test-utils';

describe('Complex Component Snapshots', () => {
  it('should match snapshot for button with all features', () => {
    const result = extract(complexButtonCode);
    expect(SnapshotHelper.formatExtractionResult(result))
      .toMatchSnapshot();
  });
});
```

## Implementation Notes

1. **Package Structure**:
   ```
   packages/core/src/v2/
   ├── test-utils/
   │   ├── index.ts         # Main exports
   │   ├── builders.ts      # Code builders
   │   ├── typescript.ts    # TS helpers
   │   ├── extraction.ts    # Extraction harness
   │   ├── assertions.ts    # Custom assertions
   │   ├── snapshots.ts     # Snapshot formatting
   │   ├── mocks.ts         # Mock data
   │   └── integration.ts   # Integration helpers
   └── __tests__/
       ├── jest.config.js   # Jest configuration
       └── setup.ts         # Global test setup
   ```

2. **Jest Configuration**:
   ```javascript
   // jest.config.js
   module.exports = {
     preset: 'ts-jest',
     testEnvironment: 'node',
     moduleNameMapper: {
       '@test-utils': '<rootDir>/test-utils'
     },
     snapshotSerializers: [
       '<rootDir>/test-utils/snapshots'
     ],
     setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts']
   };
   ```

3. **TypeScript Configuration**:
   ```json
   // tsconfig.test.json
   {
     "extends": "../tsconfig.json",
     "compilerOptions": {
       "paths": {
         "@test-utils": ["./test-utils"]
       }
     }
   }
   ```

## Benefits

1. **Reduced Boilerplate**: No more manual TypeScript program creation
2. **Readable Tests**: Clear, focused test cases
3. **Consistent Patterns**: Same helpers across all feature tests
4. **Better Snapshots**: Formatted, human-readable snapshot output
5. **Type Safety**: Full TypeScript support in test helpers
6. **Easy Debugging**: Helpers provide clear error messages
7. **Reusable Mocks**: Common test data readily available

## Future Enhancements

1. **Visual Test Reporter**: Show extracted CSS visually
2. **Performance Benchmarks**: Built-in performance testing
3. **Coverage Reports**: Track which features are tested
4. **Test Data Generator**: Randomly generate valid components
5. **Debugging Tools**: Step-through extraction process