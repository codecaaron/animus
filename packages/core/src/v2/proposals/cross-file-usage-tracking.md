# Feature: Cross-file Component Usage Tracking

## Problem Statement
- Currently, the static extractor only finds component usages within the same file where the component is defined
- This limitation prevents accurate CSS generation for components used across multiple files
- Real-world applications typically have components defined in one file and used in many others
- Without cross-file tracking, we miss most actual component usage patterns

Which of the remaining features does this implement?
- [x] Cross-file component usage tracking
- [ ] Deep theme resolution
- [ ] Full variant/state processing
- [ ] Multi-file scope analysis

## Phase Analysis
- Primary phase affected: Phase 3 (Usage Collection)
- Secondary phases impacted: None
- Why Phase 3 owns this logic: Phase 3 is responsible for finding all JSX usages of components. Extending it to look beyond the current file is a natural evolution of its existing responsibility.

## Data Flow Changes

### New types needed:
```typescript
// types/phases.ts
interface CrossFileReference {
  componentName: string;
  exportedFrom: string; // File path
  importedAs?: string; // Renamed import
  isDefault: boolean;
  isNamespaced: boolean;
}

// Update UsageCollectionOutput
interface UsageCollectionOutput {
  usages: ComponentUsage[];
  crossFileReferences: CrossFileReference[]; // NEW
}
```

### Modified interfaces:
```typescript
// types/extraction.ts
interface ComponentUsage {
  // ... existing fields
  sourceFile?: string; // NEW: Track which file the usage came from
}

// types/core.ts - Add to ExtractionContext
interface ExtractionContext {
  // ... existing fields
  crossFileImports: Map<string, CrossFileReference[]>; // NEW
}
```

### Context additions:
- `crossFileImports`: Map to track component imports across files
- Phase 3 will populate this map when it finds imports of extracted components

## Implementation Approach

### 1. Add CrossFileResolver to infrastructure
```typescript
// infrastructure/crossFileResolver.ts
export class CrossFileResolver {
  constructor(
    private program: ts.Program,
    private typeChecker: ts.TypeChecker
  ) {}

  resolveImport(importDeclaration: ts.ImportDeclaration): CrossFileReference[]
  findExportsFromFile(filePath: string): ExportedComponent[]
  matchImportToComponent(importRef: CrossFileReference, componentDef: ComponentDefinition): boolean
}
```

### 2. Enhance UsageCollectionPhase
```typescript
// phases/usageCollection.ts
export class UsageCollectionPhase {
  execute(
    context: ExtractionContext,
    input: UsageCollectionInput
  ): UsageCollectionOutput {
    // ... existing logic
    
    // NEW: Collect imports first
    this.collectImports(context.sourceFile);
    
    // ... collect usages
    
    return {
      usages,
      crossFileReferences: this.identifyCrossFileReferences()
    };
  }

  private collectImports(sourceFile: ts.SourceFile): void {
    ts.forEachChild(sourceFile, node => {
      if (ts.isImportDeclaration(node)) {
        const importPath = this.resolveImportPath(node);
        const specifiers = this.parseImportSpecifiers(node);
        
        // Store in context for cross-referencing
        this.context.crossFileImports.set(importPath, specifiers);
      }
    });
  }

  private identifyCrossFileReferences(): CrossFileReference[] {
    const references: CrossFileReference[] = [];
    
    // Check each usage against imports
    for (const usage of this.usages) {
      const importInfo = this.findComponentImport(usage.componentName);
      
      if (importInfo && importInfo.isExternal) {
        references.push({
          componentName: usage.componentName,
          exportedFrom: importInfo.source,
          importedAs: importInfo.localName,
          isDefault: importInfo.isDefault,
          isNamespaced: false
        });
      }
    }
    
    return references;
  }
```

### 3. Update orchestrator to handle cross-file references
```typescript
// orchestrator.ts
// After phase 3, check for cross-file references
// Queue them for processing in a second pass
// Note: Initial implementation will just identify, not follow
```

### 4. Test strategy
- Unit tests for CrossFileResolver
- Integration test with multi-file fixture:
  - ComponentFile.tsx (defines component)
  - UsageFile.tsx (uses component)
  - Verify cross-file reference is detected
- Snapshot test showing cross-file references in output

## Documentation Updates Required

### ARCHITECTURE.md sections:
- Update "Current Limitations" to mark cross-file as partially implemented
- Add new section under "How It Works" explaining cross-file detection
- Update Phase 3 description in mermaid diagram

### Type definitions:
- Document new CrossFileReference type
- Update ComponentUsage interface docs
- Add crossFileImports to ExtractionContext docs

### Test snapshots:
- Add new snapshot for cross-file detection test
- Update existing snapshots if output format changes

## Risk Assessment

### Breaking changes:
- None - additions only, existing API unchanged

### Performance impact:
- Minimal - only tracks imports, doesn't follow them yet
- Import analysis is fast (single AST traversal)
- No additional file I/O in initial implementation

### Memory usage:
- Small increase for crossFileImports map
- Approximately 100 bytes per import reference
- For 1000 imports = ~100KB additional memory

## Future Considerations
This implementation sets the foundation for full multi-file analysis by:
1. Identifying where components are used outside their definition file
2. Creating the data structures needed for cross-file tracking
3. Establishing patterns for import resolution

The actual following of cross-file references will be implemented as part of the "Multi-file Scope" feature.