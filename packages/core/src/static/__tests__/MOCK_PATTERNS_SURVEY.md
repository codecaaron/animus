# Ethnographic Survey of TypeScript Compiler and File System Mock Patterns

## The Mock Civilizations of Animus Static Analysis

This document captures the cultural patterns observed across the test suites, documenting how different tribes of tests simulate their alternate realities.

## 1. File System Mocking Patterns

### The Temporary Kingdom Pattern
Most tests establish temporary realms using OS temp directories:

```typescript
// The ritual of creating ephemeral worlds
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-name-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
```

### The File Creation Ceremony
A common helper function pattern for manifesting files:

```typescript
const createTestFile = (filename: string, content: string): string => {
  const filePath = path.join(tempDir, filename);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content);
  return filePath;
};
```

## 2. TypeScript Program Mocking Patterns

### The Program Creation Ritual
A standard pattern for summoning TypeScript programs:

```typescript
const createProgram = (files: string[]): ts.Program => {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
  };
  return ts.createProgram(files, options);
};
```

### The Config Discovery Pattern
Some tests seek tsconfig.json for more authentic simulations:

```typescript
function createProgram(rootDir: string, files?: string[]): ts.Program {
  const configPath = ts.findConfigFile(
    rootDir,
    ts.sys.fileExists,
    'tsconfig.json'
  );

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      rootDir
    );
    return ts.createProgram({
      rootNames: files || parsedConfig.fileNames,
      options: parsedConfig.options,
    });
  }
  // Fallback to default options...
}
```

## 3. Mock Data Structure Patterns

### The Component Node Mock Factory
Creating artificial component representations:

```typescript
const createMockComponentNode = (name: string): ComponentNode => ({
  identity: {
    name,
    filePath: `/test/components/${name}.tsx`,
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
  allProps: {
    p: { property: 'padding', scale: 'space' },
    m: { property: 'margin', scale: 'space' },
  },
  groups: ['space', 'color'],
  extraction: {
    baseStyles: { padding: '8px' },
  } as any,
  metadata: {
    className: `${name}-abc123`,
    hash: `hash-${name}`,
  } as any,
});
```

### The Extract Function Mock
Simulating extraction results:

```typescript
export const createMockExtract = (results: any[] = []) => {
  return vi.fn().mockResolvedValue({
    results,
    registry: {
      getAllComponents: () => results.map(r => r.componentName),
      getComponentDefinition: (name: string) => 
        results.find(r => r.componentName === name),
      getInheritanceChain: (name: string) => {
        const component = results.find(r => r.componentName === name);
        return component?.extends ? [component.extends] : [];
      },
    },
  });
};
```

## 4. AST Creation Patterns

### Direct TypeScript API Usage
Tests create ASTs by writing actual TypeScript code as strings:

```typescript
const buttonFile = createTestFile(
  'Button.tsx',
  `
  import { animus } from '@animus-ui/core';

  export const Button = animus
    .styles({ padding: '8px 16px' })
    .asElement('button');
  `
);
```

The TypeScript compiler then parses these strings into real ASTs.

### No Manual AST Construction
Notably absent: manual AST node creation using TypeScript factory functions.
Tests prefer authentic parsing over synthetic construction.

## 5. Module Resolution Mocking

### Real File System Resolution
Tests create actual files and let TypeScript resolve them naturally:

```typescript
// Create interconnected files
const buttonFile = createTestFile('Button.tsx', '...');
const appFile = createTestFile('App.tsx', `
  import { Button } from './Button';
  export const App = () => <Button />;
`);

// TypeScript handles the resolution
program = createProgram([buttonFile, appFile]);
```

## 6. Vitest Mocking Patterns

### Module Mocking with Spies
```typescript
vi.mock('../typescript-extractor', { spy: true });
vi.mock('../component-graph', { spy: true });
```

### Mock Implementation Injection
```typescript
const mockExtractor = {
  initializeProgram: vi.fn(),
  extractFromFile: vi.fn().mockReturnValue([...]),
  buildResolutionMap: vi.fn().mockReturnValue({}),
};

(TypeScriptExtractor as any).mockImplementation(() => mockExtractor);
```

## 7. Common Test File Patterns

### Component Definition Templates
```typescript
// Basic component
`export const Button = animus.styles({}).asElement('button');`

// Component with variants
`export const Button = animus
  .variant({
    prop: 'variant',
    variants: {
      primary: { backgroundColor: 'blue' },
      secondary: { backgroundColor: 'gray' }
    }
  })
  .asElement('button');`

// Component with states
`export const Button = animus
  .states({
    disabled: { opacity: 0.5, cursor: 'not-allowed' }
  })
  .asElement('button');`
```

### JSX Usage Templates
```typescript
// Simple usage
`<Button size="small" />`

// With responsive props
`<Box p={[1, 2, 3]} />`
`<Box p={{ _: 1, sm: 2 }} />`

// With spread props
`<Button {...props} color="blue" />`

// With conditional props
`<Button size={isLarge ? 'lg' : 'sm'} />`
```

## 8. Edge Case Handling

### Dynamic Expression Markers
Tests document that dynamic expressions return undefined:
```typescript
// Template literals, variables, and expressions all yield undefined
expect(usages[0].props.className).toBeUndefined(); // for `prefix-${variant}`
expect(usages[0].props.p).toBeUndefined(); // for userSpacing variable
```

### Compound Component Limitations
Tests acknowledge current limitations:
```typescript
// Note: The current implementation doesn't resolve compound components
// This test documents the current behavior
const usages = collector.collectFromFile(appFile);
expect(usages).toHaveLength(0); // for <Layout.Header />
```

## Cultural Observations

1. **Preference for Authenticity**: Tests create real files and use real TypeScript parsing rather than synthetic mocks.

2. **Isolation Through Temporality**: Each test creates its own temporary universe, ensuring no cross-contamination.

3. **String-Based Reality**: Component definitions exist as string literals that become real through parsing.

4. **Documentation Through Testing**: Edge cases and limitations are documented as test expectations.

5. **Helper Function Proliferation**: Similar helper patterns appear across test files, suggesting a shared cultural practice.

6. **No Complex AST Mocking**: The absence of ts.factory usage suggests either:
   - The real parser is sufficient for all test needs
   - AST manipulation happens at a higher abstraction level
   - Tests focus on integration rather than unit testing individual AST operations

This survey reveals a testing culture that values realistic simulation over artificial construction, creating miniature worlds that mirror production environments while maintaining strict isolation.