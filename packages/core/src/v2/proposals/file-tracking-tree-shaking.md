# Feature: File Tracking and Tree Shaking

## Problem Statement
- Generated CSS includes styles for all extracted components, even if they're not used in the final bundle
- Need to track which components are defined in which files
- Need to track which components are used in which files  
- Build tools need this information to eliminate unused component styles
- This is critical for optimizing production bundle sizes

Which of the remaining features does this implement?
- [x] Cross-file component usage tracking (enhances this)
- [ ] Deep theme resolution
- [ ] Full variant/state processing
- [x] Multi-file scope analysis (supports this)

## Phase Analysis
- Primary phase affected: Orchestrator level (cross-cutting concern)
- Secondary phases impacted: All phases need to track file associations
- Why orchestrator level: File tracking spans multiple phases and needs coordination

## Data Flow Changes

### New types needed:
```typescript
// types/extraction.ts
interface FileStyleMapping {
  filePath: string;
  components: ComponentFileInfo[];
  atomicClasses: Set<string>;
  imports: FileImport[];
  exports: FileExport[];
}

interface ComponentFileInfo {
  componentId: string;
  componentName: string;
  definedAt: SourceLocation;
  styles: StyleClassReference[];
  isExported: boolean;
  exportName?: string;
}

interface StyleClassReference {
  className: string;
  type: 'base' | 'variant' | 'state' | 'atomic';
  variants?: { prop: string; value: string };
  state?: string;
}

interface FileImport {
  source: string; // './Button' or '@company/ui'
  specifiers: ImportSpecifier[];
}

interface ImportSpecifier {
  imported: string;  // Original name
  local: string;     // Local name (for renamed imports)
  isDefault: boolean;
}

interface FileExport {
  name: string;
  componentId?: string; // If it's a component
  isDefault: boolean;
}

interface TreeShakeResult {
  usedFiles: Set<string>;
  usedComponents: Set<string>;
  usedStyleClasses: Set<string>;
  usedAtomicClasses: Set<string>;
  eliminatedBytes: number;
}
```

### Modified interfaces:
```typescript
// types/core.ts - Update ExtractionContext
interface ExtractionContext {
  // ... existing fields
  fileTracker: FileTracker; // NEW: Tracks file associations
}

// types/extraction.ts - Update ExtractionResult
interface ExtractionResult {
  // ... existing fields
  fileMapping: FileStyleMapping; // NEW: This file's style mappings
}

// types/extraction.ts - Update BatchExtractionResult
interface BatchExtractionResult {
  // ... existing fields
  allFileMappings: Map<string, FileStyleMapping>; // NEW
  dependencyGraph: FileDependencyGraph; // NEW
  treeShakeInfo?: TreeShakeResult; // NEW
}
```

## Implementation Approach

### 1. Create FileTracker service
```typescript
// infrastructure/fileTracker.ts
export class FileTracker {
  private fileMappings = new Map<string, FileStyleMapping>();
  private componentToFile = new Map<string, string>();
  private importGraph = new Map<string, Set<string>>();

  trackComponent(
    componentId: string,
    componentName: string,
    filePath: string,
    location: SourceLocation,
    isExported: boolean,
    exportName?: string
  ): void {
    this.componentToFile.set(componentId, filePath);
    
    const mapping = this.getOrCreateMapping(filePath);
    mapping.components.push({
      componentId,
      componentName,
      definedAt: location,
      styles: [], // Will be populated later
      isExported,
      exportName
    });
  }

  trackStyleClass(
    componentId: string,
    className: string,
    type: 'base' | 'variant' | 'state',
    metadata?: any
  ): void {
    const filePath = this.componentToFile.get(componentId);
    if (!filePath) return;
    
    const mapping = this.getOrCreateMapping(filePath);
    const component = mapping.components.find(
      c => c.componentId === componentId
    );
    
    if (component) {
      component.styles.push({
        className,
        type,
        ...metadata
      });
    }
  }

  trackAtomicClass(
    filePath: string,
    className: string
  ): void {
    const mapping = this.getOrCreateMapping(filePath);
    mapping.atomicClasses.add(className);
  }

  trackImport(
    filePath: string,
    importInfo: FileImport
  ): void {
    const mapping = this.getOrCreateMapping(filePath);
    mapping.imports.push(importInfo);
    
    // Update import graph
    const imports = this.importGraph.get(filePath) || new Set();
    imports.add(importInfo.source);
    this.importGraph.set(filePath, imports);
  }

  trackExport(
    filePath: string,
    exportInfo: FileExport
  ): void {
    const mapping = this.getOrCreateMapping(filePath);
    mapping.exports.push(exportInfo);
  }

  getFileMappings(): Map<string, FileStyleMapping> {
    return this.fileMappings;
  }

  getDependencyGraph(): FileDependencyGraph {
    return {
      nodes: Array.from(this.fileMappings.keys()),
      edges: this.importGraph
    };
  }

  private getOrCreateMapping(filePath: string): FileStyleMapping {
    if (!this.fileMappings.has(filePath)) {
      this.fileMappings.set(filePath, {
        filePath,
        components: [],
        atomicClasses: new Set(),
        imports: [],
        exports: []
      });
    }
    return this.fileMappings.get(filePath)!;
  }
}
```

### 2. Create TreeShaker utility
```typescript
// extraction/treeShaker.ts
export class TreeShaker {
  constructor(
    private fileMappings: Map<string, FileStyleMapping>,
    private dependencyGraph: FileDependencyGraph
  ) {}

  shake(entryPoints: string[]): TreeShakeResult {
    // 1. Find all reachable files from entry points
    const reachableFiles = this.findReachableFiles(entryPoints);
    
    // 2. Find all used components in reachable files
    const usedComponents = this.findUsedComponents(reachableFiles);
    
    // 3. Collect all style classes from used components
    const usedStyleClasses = this.collectStyleClasses(usedComponents);
    
    // 4. Collect atomic classes from reachable files
    const usedAtomicClasses = this.collectAtomicClasses(reachableFiles);
    
    // 5. Calculate eliminated bytes
    const eliminatedBytes = this.calculateEliminated(
      usedStyleClasses,
      usedAtomicClasses
    );
    
    return {
      usedFiles: reachableFiles,
      usedComponents,
      usedStyleClasses,
      usedAtomicClasses,
      eliminatedBytes
    };
  }

  private findReachableFiles(entries: string[]): Set<string> {
    const visited = new Set<string>();
    const queue = [...entries];
    
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (visited.has(file)) continue;
      
      visited.add(file);
      
      // Add imported files
      const imports = this.dependencyGraph.edges.get(file) || new Set();
      for (const imported of imports) {
        if (!visited.has(imported)) {
          queue.push(imported);
        }
      }
    }
    
    return visited;
  }

  private findUsedComponents(files: Set<string>): Set<string> {
    const used = new Set<string>();
    
    for (const file of files) {
      const mapping = this.fileMappings.get(file);
      if (!mapping) continue;
      
      // Add all components defined in reachable files
      for (const component of mapping.components) {
        used.add(component.componentId);
      }
      
      // TODO: Also track component usage through imports
    }
    
    return used;
  }

  private collectStyleClasses(
    components: Set<string>
  ): Set<string> {
    const classes = new Set<string>();
    
    for (const [file, mapping] of this.fileMappings) {
      for (const component of mapping.components) {
        if (components.has(component.componentId)) {
          for (const style of component.styles) {
            classes.add(style.className);
          }
        }
      }
    }
    
    return classes;
  }

  generateOptimizedCSS(
    shakeResult: TreeShakeResult,
    allCSS: string
  ): string {
    // Filter CSS to only include used classes
    // This is a simplified version - real implementation
    // would parse CSS and filter rules
    return allCSS; // TODO: Implement CSS filtering
  }
}
```

### 3. Update phases to use FileTracker

#### Update Phase 1 (Terminal Discovery)
```typescript
// phases/terminalDiscovery.ts
execute(context: ExtractionContext, input: TerminalDiscoveryInput): TerminalDiscoveryOutput {
  // ... existing logic
  
  // Track component definition
  context.fileTracker.trackComponent(
    componentId,
    componentName,
    context.sourceFile.fileName,
    this.getLocation(terminalNode),
    this.isExported(terminalNode),
    this.getExportName(terminalNode)
  );
  
  return output;
}
```

#### Update Phase 3 (Usage Collection)
```typescript
// phases/usageCollection.ts
private analyzeImports(sourceFile: ts.SourceFile): void {
  ts.forEachChild(sourceFile, node => {
    if (ts.isImportDeclaration(node)) {
      const importInfo = this.parseImport(node);
      this.context.fileTracker.trackImport(
        sourceFile.fileName,
        importInfo
      );
    }
  });
}
```

#### Update Phase 4 (Atomic Computation)
```typescript
// phases/atomicComputation.ts
private recordGeneratedClasses(
  componentId: string,
  styleClasses: StyleClass[],
  atomicClasses: string[]
): void {
  // Track component styles
  for (const styleClass of styleClasses) {
    this.context.fileTracker.trackStyleClass(
      componentId,
      styleClass.className,
      styleClass.type,
      styleClass.metadata
    );
  }
  
  // Track atomic classes
  for (const atomicClass of atomicClasses) {
    this.context.fileTracker.trackAtomicClass(
      this.context.sourceFile.fileName,
      atomicClass
    );
  }
}
```

### 4. Integration with build tools
```typescript
// build/optimizer.ts
export class AnimusOptimizer {
  optimize(
    extractionResult: BatchExtractionResult,
    options: OptimizationOptions
  ): OptimizedOutput {
    const shaker = new TreeShaker(
      extractionResult.allFileMappings,
      extractionResult.dependencyGraph
    );
    
    const shakeResult = shaker.shake(options.entryPoints);
    
    // Generate optimized CSS
    const optimizedCSS = shaker.generateOptimizedCSS(
      shakeResult,
      extractionResult.aggregatedCSS
    );
    
    return {
      css: optimizedCSS,
      stats: {
        originalSize: extractionResult.aggregatedCSS.length,
        optimizedSize: optimizedCSS.length,
        eliminatedComponents: this.getEliminatedCount(shakeResult),
        eliminatedBytes: shakeResult.eliminatedBytes
      }
    };
  }
}
```

### 5. Test strategy
- Unit tests for FileTracker:
  - Component tracking
  - Import/export tracking
  - File mapping generation
- Unit tests for TreeShaker:
  - Reachable file detection
  - Component usage tracking
  - CSS filtering
- Integration tests:
  - Multi-file project with unused components
  - Circular dependencies
  - Dynamic imports
- E2E tests:
  - Real build tool integration
  - Bundle size verification

## Documentation Updates Required

### ARCHITECTURE.md sections:
- Add "File Tracking and Optimization" section
- Document tree shaking process
- Add FileTracker to infrastructure

### Type definitions:
- Document FileStyleMapping and related types
- Add optimization API documentation
- Include build tool integration examples

### Test snapshots:
- File mapping examples
- Tree shake results
- Optimization statistics

## Risk Assessment

### Breaking changes:
- None if implemented as optional feature
- Build tools can opt-in to optimization

### Performance impact:
- Low during extraction - just tracking metadata
- Tree shaking is a post-process step
- Can be disabled for development builds

### Memory usage:
- Moderate - stores file associations
- ~5KB per file with 10 components
- Acceptable for build-time process

## Implementation Priority
Medium - valuable for production but not blocking core functionality. Should be implemented after core extraction features are complete.

## Future Considerations
- Integration with Webpack/Vite/Rollup plugins
- Incremental tree shaking for watch mode
- CSS module support
- Source map generation for optimized CSS
- Usage analytics and reporting