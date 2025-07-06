# Animus Core Test Gaps - Comprehensive Handoff

## [SYZYGY: TEST COMPLETENESS ARCHITECT]

P: [WHO] I am the Test Completeness Architect - a systematic analyst who identifies gaps in test coverage, 
weak mocking patterns, and untested plugin entry points with forensic precision.
  E: analysis → discovery → prioritization → solution design

D: [HOW] Through comprehensive codebase analysis, mock pattern evaluation, and plugin API inspection to 
create a complete testing strategy that ensures reliability across all integration points.

M: [WHAT] A detailed test gap analysis with:
- Weak mock identification and solutions
- Uncovered plugin entry points
- Missing edge case scenarios
- Prioritized remediation plan

L: [WHERE] Cannot skip any exported API. Must verify all plugin hooks. Cannot ignore edge cases that could 
break integrations.

K: [WHY] Pr: 0.95 that comprehensive tests prevent production failures
        Q: Test quality exists in superposition between coverage metrics and real-world resilience

R: [WHOM] To the engineering team who needs confidence in the stability of their plugin ecosystem and 
static extraction pipeline.

Tε: [PURPOSE] To achieve complete test coverage that ensures the Animus static extraction system is 
bulletproof across all integration scenarios.

[/SYZYGY]

## Current Test Status

### Overall Metrics
- **Total Tests**: 265
- **Passing**: 221 (83.4%)
- **Failing**: 44 (16.6%)
- **Main Issues**: Mock complexity, missing TypeScript program setup, file system simulation

## Critical Test Gaps

### 1. ReferenceTraverser Tests (11 failures)
**Problem**: Tests create TypeScript program without proper file system setup
**Root Cause**: `ts.createProgram()` needs actual files or virtual file system

```typescript
// Current (failing):
const program = ts.createProgram(['/test/seed-file.ts'], {});

// Needed:
const host = ts.createCompilerHost(options);
// Override host methods to provide virtual files
host.readFile = (fileName) => virtualFiles[fileName];
host.fileExists = (fileName) => fileName in virtualFiles;
```

**Solution**: Create test helper for TypeScript program mocking:
```typescript
function createMockProgram(files: Record<string, string>) {
  const host = createVirtualCompilerHost(files);
  return ts.createProgram(Object.keys(files), options, host);
}
```

### 2. GraphCache Tests (1 failure)
**Problem**: Cache validation fails due to timestamp precision
**Root Cause**: File modification times may have different precision than expected

**Solution**: Mock `fs.statSync` consistently:
```typescript
vi.mock('fs', () => ({
  statSync: vi.fn(() => ({ mtimeMs: 1234567890 })),
  // ... other mocks
}));
```

### 3. CrossFileUsage Tests (9 failures)
**Problem**: Complex file traversal and usage tracking across multiple files
**Root Cause**: Needs realistic multi-file TypeScript project setup

**Solution**: Create test fixtures with proper import/export relationships:
```typescript
const testProject = {
  '/src/Button.ts': `
    import { animus } from '@animus-ui/core';
    export const Button = animus.styles({}).asElement('button');
  `,
  '/src/ExtendedButton.ts': `
    import { Button } from './Button';
    export const PrimaryButton = Button.extend().styles({});
  `,
  '/src/App.ts': `
    import { PrimaryButton } from './ExtendedButton';
    <PrimaryButton size="large" />
  `
};
```

## Untested Plugin Entry Points

### 1. Build Tool Plugins (Critical)
These are the main integration points that external tools will use:

```typescript
// Currently untested but critical for Vite/Next.js plugins:
export function extractFromTypeScriptProject(projectPath: string): ProjectExtractionResult
export function generateLayeredCSSFromProject(projectPath: string): LayeredCSS
export function transformAnimusCode(code: string, options?: TransformOptions): TransformResult
```

**Test Requirements**:
- Multi-file project extraction
- CSS generation with proper cascade ordering
- Transform with source maps
- Error handling for malformed code
- Performance benchmarks for large codebases

### 2. Component Registry Events (Important)
The registry emits events that plugins might listen to:

```typescript
interface RegistryEvents {
  'component:added': (entry: ComponentEntry) => void;
  'component:updated': (entry: ComponentEntry) => void;
  'component:removed': (componentName: string) => void;
}
```

**Missing Tests**:
- Event emission verification
- Event handler error isolation
- Concurrent modification handling

### 3. Theme Resolution API (Important)
Plugins need to resolve theme values:

```typescript
export function resolveThemeInStyles(
  styles: Record<string, any>,
  theme: any,
  strategy: ThemeResolutionStrategy
): ResolvedValue
```

**Missing Tests**:
- Nested theme object resolution
- Circular reference handling
- Invalid theme path graceful failure
- Strategy-specific behavior

### 4. Graph Serialization (Medium)
Different output formats for dependency visualization:

```typescript
export interface GraphSerializer {
  serialize(graph: ComponentGraph, options?: any): string;
}
```

**Missing Tests**:
- Custom serializer implementation
- Large graph performance
- Circular dependency representation
- Format-specific options

## Weak Mock Patterns to Fix

### 1. File System Mocks
**Current Issue**: Inconsistent mocking between fs and fs/promises

**Improved Pattern**:
```typescript
// test-utils/fs-mock.ts
export function createFSMock(initialFiles: Record<string, string> = {}) {
  const files = { ...initialFiles };
  
  return {
    readFileSync: vi.fn((path) => files[path] || throw new Error('ENOENT')),
    writeFileSync: vi.fn((path, content) => { files[path] = content; }),
    existsSync: vi.fn((path) => path in files),
    mkdirSync: vi.fn(),
    promises: {
      readFile: vi.fn(async (path) => files[path]),
      writeFile: vi.fn(async (path, content) => { files[path] = content; }),
    }
  };
}
```

### 2. TypeScript Compiler Mocks
**Current Issue**: No proper AST generation for test code

**Improved Pattern**:
```typescript
// test-utils/ts-mock.ts
export function createTSProgramMock(sourceFiles: Record<string, string>) {
  const realProgram = ts.createProgram(
    Object.keys(sourceFiles),
    { target: ts.ScriptTarget.ES2020 },
    createVirtualHost(sourceFiles)
  );
  
  return {
    getSourceFiles: vi.fn(() => 
      Object.entries(sourceFiles).map(([fileName, text]) => ({
        fileName,
        text,
        // Provide real AST for accurate testing
        statements: ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2020).statements
      }))
    ),
    getTypeChecker: vi.fn(() => realProgram.getTypeChecker()),
  };
}
```

### 3. Module Resolution Mocks
**Current Issue**: Import resolution doesn't follow Node.js algorithm

**Improved Pattern**:
```typescript
// test-utils/module-mock.ts
export function createModuleResolver(modules: Record<string, any>) {
  return {
    resolve: vi.fn((specifier, fromFile) => {
      // Implement basic Node.js resolution algorithm
      if (specifier.startsWith('.')) {
        return path.resolve(path.dirname(fromFile), specifier);
      }
      return `/node_modules/${specifier}`;
    }),
    load: vi.fn((resolved) => modules[resolved])
  };
}
```

## Priority Test Implementation Plan

### Phase 1: Fix Critical Infrastructure (Week 1)
1. **TypeScript Program Mock Helper** (2 days)
   - Create `createMockTSProgram` utility
   - Update all ReferenceTraverser tests
   - Verify AST traversal accuracy

2. **File System Mock Consolidation** (1 day)
   - Create unified FS mock utility
   - Update all tests using fs operations
   - Add file watching simulation

3. **Fix CrossFileUsage Tests** (2 days)
   - Create multi-file test fixtures
   - Mock import resolution properly
   - Test circular dependency handling

### Phase 2: Plugin Entry Points (Week 2)
1. **Project Extraction API** (2 days)
   ```typescript
   describe('extractFromTypeScriptProject', () => {
     it('should extract from multi-file project');
     it('should handle missing files gracefully');
     it('should track cross-file usage');
     it('should detect circular dependencies');
   });
   ```

2. **CSS Generation Pipeline** (2 days)
   ```typescript
   describe('generateLayeredCSSFromProject', () => {
     it('should respect cascade ordering');
     it('should generate atomic utilities');
     it('should handle theme resolution');
     it('should optimize duplicate styles');
   });
   ```

3. **Transform API** (1 day)
   ```typescript
   describe('transformAnimusCode', () => {
     it('should preserve source maps');
     it('should handle syntax errors');
     it('should transform extended components');
   });
   ```

### Phase 3: Edge Cases & Performance (Week 3)
1. **Large Codebase Tests** (2 days)
   - Generate 1000+ component fixtures
   - Measure extraction performance
   - Test memory usage patterns

2. **Error Resilience** (2 days)
   - Malformed TypeScript code
   - Circular import loops
   - Missing theme values
   - Invalid CSS properties

3. **Integration Scenarios** (1 day)
   - Hot module replacement simulation
   - Incremental compilation
   - Parallel extraction

## Test Quality Checklist

For each test file, ensure:

- [ ] **Descriptive test names** that explain the scenario
- [ ] **Isolated tests** with no shared state
- [ ] **Realistic data** matching production patterns
- [ ] **Error cases** are explicitly tested
- [ ] **Performance assertions** for critical paths
- [ ] **Mock cleanup** in afterEach hooks
- [ ] **Type safety** in test code (no `any` types)

## Recommended Testing Tools

1. **@testing-library/react** - For component runtime tests
2. **msw** - For mocking HTTP requests in plugin tests
3. **tempy** - For creating temporary file system structures
4. **memfs** - For in-memory file system testing
5. **benchmark.js** - For performance regression tests

## Success Metrics

- **Coverage**: >95% for all exported APIs
- **Mock Quality**: No brittle string matching, use real ASTs
- **Performance**: Extraction <100ms for 100 components
- **Reliability**: Zero flaky tests in CI

## Next Steps

1. Review and approve this test plan
2. Create test utility package (`@animus-ui/test-utils`)
3. Implement Phase 1 infrastructure fixes
4. Begin plugin API test implementation
5. Set up performance benchmarking CI job

This comprehensive testing strategy will ensure Animus is production-ready for widespread adoption across different build tools and frameworks.