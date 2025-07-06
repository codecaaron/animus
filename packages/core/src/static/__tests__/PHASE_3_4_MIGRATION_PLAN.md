# Phase 3 & 4 Quantum Migration Plan

## Overview

Phase 3 & 4 tests represent the most complex integration tests that heavily rely on:
- Real TypeScript Program instances
- File system operations
- Cross-file dependency tracking
- Stateful components (registries, caches)
- Complex AST traversal

These cannot be easily converted to pure string-based testing without losing critical behaviors.

## Analysis of Remaining Tests

### 1. **cross-file-usage.test.ts** (453 lines)
**Purpose**: Tests cross-file component usage tracking using TypeScript compiler API
**Dependencies**: 
- Real TypeScript Program
- File system for multi-file projects
- AST traversal across files
- Import resolution

**Critical Behaviors That Cannot Be Migrated**:
- Cross-file import resolution
- TypeScript type information for component identity
- Program-wide usage aggregation
- File-based caching

**Migration Strategy**: **HYBRID APPROACH**
- Keep TypeScript Program tests for cross-file scenarios
- Add quantum tests for single-file usage extraction
- Create mock cross-file resolver for simple cases

### 2. **edge-cases.test.ts** (382 lines)
**Purpose**: Tests complex patterns and edge cases
**Dependencies**: Mostly string-based already!

**Migration Strategy**: **FULL MIGRATION POSSIBLE**
- Already uses `extractStylesFromCode()`
- Can be directly converted to quantum test
- No file system dependencies

### 3. **extension-cascade-ordering.test.ts** (708 lines)
**Purpose**: Tests CSS cascade ordering for component inheritance
**Dependencies**:
- ComponentRegistry with TypeScript Program
- Complex inheritance tracking
- Topological sorting for cascade order

**Critical Behaviors That Cannot Be Migrated**:
- Registry state management
- Dependency graph building
- Extension chain resolution
- Cascade order verification

**Migration Strategy**: **MOCK-BASED APPROACH**
- Create mock registry for testing cascade logic
- Use string-based extraction for component definitions
- Mock the dependency resolution

### 4. **graph-cache.test.ts** (400+ lines)
**Purpose**: Tests persistent caching of component graphs
**Dependencies**:
- File system for cache storage
- File modification time tracking
- Concurrent access handling

**Critical Behaviors That Cannot Be Migrated**:
- File system cache persistence
- File stat operations for validation
- Concurrent read/write operations

**Migration Strategy**: **MINIMAL MIGRATION**
- Keep file system tests as-is
- Add quantum tests for graph serialization/deserialization
- Mock file operations where possible

### 5. **real-components.test.ts** (200+ lines)
**Purpose**: Tests extraction and generation for real-world component patterns
**Dependencies**: Mostly string-based!

**Migration Strategy**: **FULL MIGRATION POSSIBLE**
- Already uses string-based extraction
- Convert snapshots to explicit assertions
- No file system dependencies

### 6. **snapshot.test.ts** (154 lines)
**Purpose**: Integration tests using `extractAndGenerateCSS`
**Dependencies**: String-based integration function

**Migration Strategy**: **FULL MIGRATION POSSIBLE**
- Already uses string-based approach
- Keep snapshot tests for CSS output verification
- No complex dependencies

### 7. **usage-filtering.test.ts** (200+ lines)
**Purpose**: Tests usage-based atomic CSS filtering
**Dependencies**: String-based extraction and usage collection

**Migration Strategy**: **FULL MIGRATION POSSIBLE**
- Already uses string-based approach
- Can be directly converted to quantum test

## Detailed Migration Plan

### Phase 3A: Easy Migrations (String-based tests)
Priority: HIGH - These can be migrated immediately

1. **edge-cases.quantum.test.ts**
   - Direct conversion from edge-cases.test.ts
   - Keep all test cases
   - Use explicit assertions instead of some snapshots

2. **real-components.quantum.test.ts**
   - Direct conversion from real-components.test.ts
   - Convert snapshot tests to explicit assertions
   - Add more real-world patterns

3. **snapshot.quantum.test.ts**
   - Keep as integration snapshot tests
   - Use quantum test structure
   - Verify CSS output consistency

4. **usage-filtering.quantum.test.ts**
   - Direct conversion from usage-filtering.test.ts
   - Keep usage map verification
   - Add edge cases for sparse arrays

### Phase 3B: Hybrid Migrations (Partial string-based)
Priority: MEDIUM - Require careful handling

5. **cross-file-usage.quantum.test.ts**
   - Create string-based tests for single-file scenarios
   - Mock cross-file resolution for simple cases
   - Document limitations clearly
   - Keep original test for true cross-file scenarios

6. **extension-cascade-ordering.quantum.test.ts**
   - Create mock registry tests
   - Test cascade logic with string-based components
   - Mock dependency resolution
   - Verify ordering without real TypeScript Program

### Phase 4: Complex Integration (Keep as-is with documentation)
Priority: LOW - Document why these cannot be migrated

7. **graph-cache.test.ts**
   - KEEP AS-IS - File system operations are core functionality
   - Add comment explaining why quantum migration isn't suitable
   - Consider adding unit tests for serialization logic

## Mismatches to Address Later

### 1. **Sparse Array Handling**
- AST parser compacts arrays, losing positional information
- Affects responsive value mapping
- Need to fix in extractor or use different approach

### 2. **Component Detection Without .styles()**
- Extractor only finds components with `.styles()` calls
- Components using only `.groups()` or `.props()` are invisible
- Requires extractor enhancement

### 3. **Cross-File Import Resolution**
- String-based tests cannot resolve actual imports
- Mock resolution works for simple cases only
- Complex inheritance chains need real TypeScript

### 4. **File Modification Tracking**
- Cache validation requires real file stats
- Cannot be mocked effectively
- Core functionality that shouldn't be changed

### 5. **Concurrent Access Patterns**
- File-based operations have real concurrency concerns
- Mocking doesn't capture actual race conditions
- Keep original tests for reliability

## Implementation Order

1. **Week 1**: Phase 3A (Easy migrations)
   - edge-cases.quantum.test.ts ✓
   - real-components.quantum.test.ts ✓
   - snapshot.quantum.test.ts ✓
   - usage-filtering.quantum.test.ts ✓

2. **Week 2**: Phase 3B (Hybrid migrations)
   - cross-file-usage.quantum.test.ts (partial)
   - extension-cascade-ordering.quantum.test.ts (mocked)

3. **Week 3**: Documentation & Cleanup
   - Document why graph-cache.test.ts stays as-is
   - Add QUANTUM_LIMITATIONS.md for future reference
   - Update QUANTUM_TEST_HANDOFF.md with lessons learned

## Success Criteria

- All string-based tests migrated to quantum format
- Hybrid tests have clear boundaries between quantum and legacy
- Complex integration tests documented with rationale
- No loss of critical test coverage
- Clear path forward for addressing limitations

## Risk Mitigation

1. **Keep Original Tests**: Don't delete originals until quantum tests prove stable
2. **Parallel Running**: Run both test suites in CI for validation
3. **Coverage Tracking**: Ensure no coverage regression
4. **Documentation**: Clear docs on what couldn't be migrated and why
5. **Future Path**: Plan for extractor enhancements to enable more migrations