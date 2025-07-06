# Phase 3B Migration Plan: Complex Test Handoff

## Overview
Two critical test suites remain for migration to quantum format:
1. **cross-file-usage.test.ts** - Tests cross-file component usage tracking
2. **extension-cascade-ordering.test.ts** - Tests style cascade ordering for extended components

Both are Phase 3B tests requiring special handling due to their multi-file nature and complex dependencies.

## Test 1: cross-file-usage.test.ts

### Current Test Structure
```typescript
// Key test scenarios:
1. "should track component usage across files" - 166 lines
2. "should handle compound components" - 84 lines  
3. "should track usage with imports and re-exports" - 132 lines
4. "should handle usage with different import patterns" - 114 lines
5. "should collect usage from real component files" - 60 lines
```

### Migration Strategy: HYBRID APPROACH

#### Why Hybrid?
- CrossFileUsageCollector requires a real TypeScript Program
- Tests need multiple virtual files with import relationships
- Cannot be fully string-based due to module resolution requirements

#### Implementation Plan

```typescript
// cross-file-usage.quantum.test.ts
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { CrossFileUsageCollector } from '../cross-file-usage';
import { createVirtualProgram } from './test-utils';

describe('[QUANTUM] Cross-file Usage Collection', () => {
  it('should track component usage across virtual files', () => {
    // Step 1: Create virtual file system
    const files = {
      '/src/components/Button.tsx': `
        import { animus } from '@animus-ui/core';
        export const Button = animus
          .styles({ padding: '8px' })
          .groups({ space: true })
          .asElement('button');
      `,
      '/src/components/Card.tsx': `
        import { animus } from '@animus-ui/core';
        export const Card = animus
          .styles({ border: '1px solid' })
          .groups({ space: true })
          .asElement('div');
      `,
      '/src/App.tsx': `
        import { Button } from './components/Button';
        import { Card } from './components/Card';
        
        export function App() {
          return (
            <Card p={4} m={2}>
              <Button p={2} m={1} />
            </Card>
          );
        }
      `
    };

    // Step 2: Create TypeScript program with virtual files
    const program = createVirtualProgram(files);
    
    // Step 3: Run collector
    const collector = new CrossFileUsageCollector(program);
    const result = collector.collectFromFiles(['/src/App.tsx']);
    
    // Step 4: Verify usage
    expect(result.componentUsages).toHaveLength(2);
    expect(result.globalUsageMap.Button.p).toContain('2:_');
    expect(result.globalUsageMap.Card.p).toContain('4:_');
  });
});
```

### Key Gotchas & Solutions

#### 1. Virtual File System
**Gotcha**: TypeScript's createProgram expects real files
**Solution**: Implement custom CompilerHost
```typescript
// In test-utils/virtual-program.ts
export function createVirtualProgram(files: Record<string, string>) {
  const compilerHost: ts.CompilerHost = {
    getSourceFile: (fileName) => {
      const content = files[fileName];
      if (content) {
        return ts.createSourceFile(fileName, content, ts.ScriptTarget.ES2020);
      }
      // Fallback to default for lib files
      return ts.createSourceFile(fileName, '', ts.ScriptTarget.ES2020);
    },
    fileExists: (fileName) => fileName in files,
    readFile: (fileName) => files[fileName],
    // ... other required methods
  };
  
  return ts.createProgram(Object.keys(files), {}, compilerHost);
}
```

#### 2. Import Resolution
**Gotcha**: Relative imports need path resolution
**Solution**: Mock module resolution in CompilerHost
```typescript
resolveModuleNames: (moduleNames, containingFile) => {
  return moduleNames.map(moduleName => {
    if (moduleName.startsWith('.')) {
      const resolved = path.resolve(path.dirname(containingFile), moduleName);
      // Try with common extensions
      for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
        const fullPath = resolved + ext;
        if (files[fullPath]) {
          return { resolvedFileName: fullPath };
        }
      }
    }
    return undefined;
  });
}
```

#### 3. Component Identity Resolution
**Gotcha**: Components imported from other files need identity tracking
**Solution**: Ensure ImportResolver is properly initialized with the virtual program

#### 4. Compound Component Handling
**Gotcha**: Layout.Header pattern needs special handling
**Solution**: Test both parent and compound usage:
```typescript
const files = {
  '/src/Layout.tsx': `
    const Layout = animus.styles({}).asElement('div');
    const Header = animus.styles({}).asElement('header');
    Layout.Header = Header;
    export { Layout };
  `,
  '/src/App.tsx': `
    import { Layout } from './Layout';
    <Layout p={4}>
      <Layout.Header m={2} />
    </Layout>
  `
};
```

## Test 2: extension-cascade-ordering.test.ts

### Current Test Structure
```typescript
// Key test scenarios:
1. "Base → Extended cascade ordering" - Uses buildTestGraph
2. "Multi-level extension chains" - Tests A→B→C inheritance
3. "Diamond inheritance patterns" - Tests complex inheritance
4. "Mixed imports and local definitions" - Cross-file extensions
```

### Migration Strategy: MOCKED GRAPH APPROACH

#### Why Mocked?
- Tests focus on cascade ordering algorithm, not file parsing
- buildTestGraph creates synthetic component graphs
- Can be tested with mock data structures

#### Implementation Plan

```typescript
// extension-cascade-ordering.quantum.test.ts
import { describe, expect, it } from 'vitest';
import { ComponentRegistry } from '../component-registry';
import { generateLayeredCSS } from '../generator';
import { createMockComponentGraph, createMockComponentNode } from './test-utils';

describe('[QUANTUM] Extension Cascade Ordering', () => {
  it('should maintain correct cascade order for extended components', () => {
    // Step 1: Create mock component graph
    const baseButton = createMockComponentNode({
      name: 'BaseButton',
      hash: 'base-123',
      extraction: {
        baseStyles: { padding: '8px', color: 'black' }
      }
    });
    
    const primaryButton = createMockComponentNode({
      name: 'PrimaryButton', 
      hash: 'primary-456',
      parentHash: 'base-123',
      extraction: {
        baseStyles: { backgroundColor: 'blue', color: 'white' }
      }
    });
    
    const graph = createMockComponentGraph({
      components: new Map([
        ['base-123', baseButton],
        ['primary-456', primaryButton]
      ])
    });
    
    // Step 2: Generate CSS
    const result = generateLayeredCSS(graph);
    
    // Step 3: Verify cascade order
    const css = result.layers.components;
    const baseIndex = css.indexOf('.animus-BaseButton');
    const primaryIndex = css.indexOf('.animus-PrimaryButton');
    
    expect(baseIndex).toBeLessThan(primaryIndex); // Base must come first
    expect(css).toContain('color: black'); // Base style
    expect(css).toContain('color: white'); // Override in extended
  });
});
```

### Key Gotchas & Solutions

#### 1. Graph Building Complexity
**Gotcha**: buildTestGraph has complex setup logic
**Solution**: Create simplified mock builders
```typescript
export function createMockComponentNode(config: {
  name: string;
  hash: string;
  parentHash?: string;
  extraction: ExtractedStyles;
}): ComponentNode {
  return {
    identity: {
      name: config.name,
      hash: config.hash,
      filePath: `/mock/${config.name}.tsx`,
      exportName: config.name
    },
    extraction: config.extraction,
    metadata: {
      className: `${config.name}-${config.hash.slice(0,3)}`,
      hash: config.hash,
      parentHash: config.parentHash
    },
    // ... other required fields with defaults
  };
}
```

#### 2. Cascade Order Verification
**Gotcha**: CSS string parsing to verify order
**Solution**: Parse CSS into structured format
```typescript
function parseCSSOrder(css: string): string[] {
  const classNames: string[] = [];
  const regex = /\.animus-(\w+)-\w+/g;
  let match;
  while ((match = regex.exec(css)) !== null) {
    if (!classNames.includes(match[1])) {
      classNames.push(match[1]);
    }
  }
  return classNames;
}

// Usage:
const order = parseCSSOrder(result.css);
expect(order).toEqual(['BaseButton', 'PrimaryButton', 'IconButton']);
```

#### 3. Diamond Inheritance
**Gotcha**: Complex inheritance patterns (A→B, A→C, B&C→D)
**Solution**: Build graph with proper parent references
```typescript
const diamond = {
  base: createMockComponentNode({ name: 'Base', hash: 'base' }),
  left: createMockComponentNode({ name: 'Left', hash: 'left', parentHash: 'base' }),
  right: createMockComponentNode({ name: 'Right', hash: 'right', parentHash: 'base' }),
  merged: createMockComponentNode({ 
    name: 'Merged', 
    hash: 'merged',
    // How to handle multiple parents? This is a key design decision
    parentHash: 'left', // Primary parent
    metadata: { 
      secondaryParents: ['right'] // Additional parents
    }
  })
};
```

#### 4. Style Merging Verification
**Gotcha**: Verifying correct style inheritance
**Solution**: Check computed styles
```typescript
// Helper to extract computed styles for a component
function getComputedStyles(css: string, className: string): Record<string, string> {
  const styleRegex = new RegExp(`\\.${className}\\s*{([^}]+)}`, 'g');
  const match = styleRegex.exec(css);
  if (!match) return {};
  
  const styles: Record<string, string> = {};
  const declarations = match[1].split(';');
  for (const decl of declarations) {
    const [prop, value] = decl.split(':').map(s => s.trim());
    if (prop && value) {
      styles[prop] = value;
    }
  }
  return styles;
}
```

## Testing Utilities Needed

### 1. Virtual Program Creator
```typescript
// test-utils/virtual-program.ts
export function createVirtualProgram(
  files: Record<string, string>, 
  options?: ts.CompilerOptions
): ts.Program;
```

### 2. Mock Component Builders
```typescript
// test-utils/mock-builders.ts
export function createMockComponentNode(config: ComponentNodeConfig): ComponentNode;
export function createMockComponentGraph(config: GraphConfig): ComponentGraph;
export function createMockRegistry(): ComponentRegistry;
```

### 3. CSS Analysis Helpers
```typescript
// test-utils/css-helpers.ts
export function parseCSSOrder(css: string): string[];
export function getComputedStyles(css: string, className: string): Record<string, string>;
export function findStyleDeclaration(css: string, selector: string, property: string): string | null;
```

## Migration Checklist

### For cross-file-usage.quantum.test.ts:
- [ ] Implement createVirtualProgram with custom CompilerHost
- [ ] Add module resolution for relative imports
- [ ] Create test cases for all 5 scenarios
- [ ] Handle compound component patterns
- [ ] Verify import/export tracking
- [ ] Test re-export scenarios
- [ ] Add edge cases for dynamic imports

### For extension-cascade-ordering.quantum.test.ts:
- [ ] Create mock component builders
- [ ] Implement CSS parsing utilities
- [ ] Convert buildTestGraph calls to mock data
- [ ] Test single inheritance (A→B)
- [ ] Test chain inheritance (A→B→C)
- [ ] Test diamond patterns
- [ ] Verify style override behavior
- [ ] Test with variants and states

## Potential Blockers

1. **TypeScript Program Mocking**: Creating a fully functional mock TypeScript program is complex. Consider using `@typescript/vfs` if available.

2. **Import Resolution**: The virtual file system needs to handle all import patterns including index files, extension resolution, and path aliases.

3. **Component Identity**: Ensuring components maintain correct identity across file boundaries in a virtual environment.

4. **Performance**: Virtual TypeScript programs can be slow. Consider caching compiled programs between tests.

## Success Criteria

1. All original test scenarios pass in quantum format
2. No dependency on real file system
3. Tests run in < 100ms each
4. Clear separation between test setup and assertions
5. Reusable test utilities for future tests

## Next Steps

1. Start with extension-cascade-ordering.quantum.test.ts (simpler, uses mocks)
2. Build reusable test utilities
3. Then tackle cross-file-usage.quantum.test.ts (complex, needs virtual TS program)
4. Document any new patterns discovered
5. Update QUANTUM_TEST_HANDOFF.md with learnings