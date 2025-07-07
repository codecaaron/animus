# Feature: Multi-file Scope Analysis

## Problem Statement
- Current extractor operates on single files in isolation
- Cannot follow component usage across file boundaries
- Cannot aggregate CSS for an entire application or module
- Build tools need to run extraction on multiple files and merge results
- This prevents complete static extraction for real-world applications

Which of the remaining features does this implement?
- [ ] Cross-file component usage tracking (builds upon this)
- [ ] Deep theme resolution
- [ ] Full variant/state processing
- [x] Multi-file scope analysis

## Phase Analysis
- Primary phase affected: Orchestrator level (above all phases)
- Secondary phases impacted: All phases need to support batching
- Why orchestrator level: Multi-file coordination is a higher-level concern than any individual phase

## Data Flow Changes

### New types needed:
```typescript
// types/core.ts
interface MultiFileContext {
  files: Set<string>;
  sharedContext: ExtractionContext;
  fileContexts: Map<string, ExtractionContext>;
  crossFileGraph: DependencyGraph;
  aggregatedResults: Map<string, ExtractionResult>;
  globalAtomicPool: AtomicClassPool; // Shared across all files
}

interface DependencyGraph {
  nodes: Map<string, FileNode>;
  edges: Map<string, Set<string>>; // file -> imported files
}

interface FileNode {
  path: string;
  exports: ExportedSymbol[];
  imports: ImportedSymbol[];
  components: string[]; // Component IDs defined in this file
}

interface BatchExtractionResult {
  fileResults: Map<string, ExtractionResult>;
  crossFileUsages: CrossFileUsage[];
  aggregatedCSS: string;
  dependencyGraph: DependencyGraph;
  diagnostics: BatchDiagnostics;
}

interface CrossFileUsage {
  component: ComponentIdentifier;
  definedIn: string;
  usedIn: string[];
  totalUsages: number;
}
```

### Modified interfaces:
```typescript
// types/core.ts - Update main extractor
interface StaticExtractor {
  extractFile(path: string): ExtractionResult;
  extractFiles(paths: string[]): BatchExtractionResult; // NEW
  extractDirectory(path: string, options?: GlobOptions): BatchExtractionResult; // NEW
}

// types/extraction.ts - Update ExtractionResult
interface ExtractionResult {
  // ... existing fields
  exports?: ExportedSymbol[]; // NEW: What this file exports
  imports?: ImportedSymbol[]; // NEW: What this file imports
  crossFileRefs?: CrossFileReference[]; // NEW: From phase 3
}
```

### Context additions:
- `MultiFileContext` manages state across multiple file extractions
- Shared TypeScript program for all files
- Cross-file dependency tracking

## Implementation Approach

### 1. Create MultiFileOrchestrator
```typescript
// orchestrator/multiFileOrchestrator.ts
export class MultiFileOrchestrator {
  constructor(
    private config: ExtractorConfig,
    private orchestrator: StaticExtractionOrchestrator
  ) {}

  async extractFiles(paths: string[]): Promise<BatchExtractionResult> {
    // 1. Create shared TypeScript program for all files
    const program = this.createProgram(paths);
    
    // 2. Create shared resources
    const multiContext = this.createMultiFileContext(program);
    
    // 3. Build dependency graph
    const graph = this.buildDependencyGraph(program);
    
    // 4. Process files in dependency order
    const results = await this.processInOrder(paths, graph, multiContext);
    
    // 5. Resolve cross-file references
    const crossFileUsages = this.resolveCrossFileUsages(results);
    
    // 6. Aggregate results
    return this.aggregateResults(results, crossFileUsages, multiContext);
  }
  
  private createMultiFileContext(program: ts.Program): MultiFileContext {
    // Create shared resources that persist across file extractions
    const sharedContext: Partial<ExtractionContext> = {
      program,
      typeChecker: program.getTypeChecker(),
      atomicPool: new AtomicClassPool(), // Global atomic pool
      fileTracker: new FileTracker(),    // Global file tracker
      propRegistry: this.extractGlobalPropRegistry(program)
    };
    
    return {
      files: new Set(),
      sharedContext: sharedContext as ExtractionContext,
      fileContexts: new Map(),
      crossFileGraph: { nodes: new Map(), edges: new Map() },
      aggregatedResults: new Map(),
      globalAtomicPool: sharedContext.atomicPool!
    };
  }

  private buildDependencyGraph(program: ts.Program): DependencyGraph {
    // Analyze imports/exports
    // Build file dependency graph
    // Detect circular dependencies
  }

  private processInOrder(
    files: string[],
    graph: DependencyGraph
  ): ExtractionResult[] {
    // Topological sort for processing order
    // Process leaf nodes first
    // Handle circular dependencies
  }

  private resolveCrossFileUsages(
    results: Map<string, ExtractionResult>
  ): CrossFileUsage[] {
    // Match exports to imports
    // Track component usage across files
    // Build usage statistics
  }

  private aggregateCSS(
    results: ExtractionResult[]
  ): string {
    // Merge CSS from all files
    // Deduplicate classes
    // Optimize output
  }
}
```

### 2. Create FileDiscovery utility
```typescript
// utils/fileDiscovery.ts
export class FileDiscovery {
  discoverFiles(
    rootPath: string,
    options: GlobOptions
  ): string[] {
    // Find all relevant files
    // Apply include/exclude patterns
    // Sort by likely dependencies
  }

  analyzeProjectStructure(rootPath: string): ProjectStructure {
    // Identify project type
    // Find entry points
    // Suggest extraction order
  }
}
```

### 3. Update existing orchestrator for batching
```typescript
// orchestrator.ts
export class StaticExtractionOrchestrator {
  // ... existing code

  // NEW: Support for shared context
  extractFileWithContext(
    path: string,
    sharedContext?: Partial<ExtractionContext>
  ): ExtractionResult {
    // Use shared program if provided
    // Share registries across files
    // Track cross-file references
  }
}
```

### 4. Add result aggregation utilities
```typescript
// utils/resultAggregator.ts
export class ResultAggregator {
  aggregate(results: ExtractionResult[]): AggregatedResult {
    // Merge atomic classes
    // Deduplicate CSS rules
    // Generate optimized output
  }

  generateReport(batch: BatchExtractionResult): ExtractionReport {
    // Usage statistics
    // Unused components
    // Cross-file dependencies
    // Performance metrics
  }
}
```

### 5. Update main entry point
```typescript
// index.ts
export function createStaticExtractor(
  config: ExtractorConfig
): StaticExtractor {
  const orchestrator = new StaticExtractionOrchestrator(config);
  const multiFileOrchestrator = new MultiFileOrchestrator(config, orchestrator);
  
  return {
    extractFile: (path) => orchestrator.extractFile(path),
    extractFiles: (paths) => multiFileOrchestrator.extractFiles(paths),
    extractDirectory: (path, options) => {
      const files = new FileDiscovery().discoverFiles(path, options);
      return multiFileOrchestrator.extractFiles(files);
    }
  };
}
```

### 6. Test strategy
- Unit tests for MultiFileOrchestrator:
  - Dependency graph building
  - Processing order
  - Result aggregation
- Integration tests with multi-file projects:
  - Simple app with 3-5 files
  - Complex app with circular dependencies
  - Library with multiple entry points
- Performance tests:
  - 100+ file extraction
  - Memory usage monitoring
- E2E test with real Next.js/Vite app

## Documentation Updates Required

### ARCHITECTURE.md sections:
- Remove single-file limitation
- Add "Multi-file Extraction" section
- Update main diagram to show batch processing
- Document new CLI usage for directories

### Type definitions:
- Document all batch extraction types
- Add examples for multi-file usage
- Document file discovery options

### Test snapshots:
- Multi-file extraction snapshots
- Aggregated CSS output examples
- Dependency graph visualizations

## Risk Assessment

### Breaking changes:
- None - single-file API remains unchanged
- New APIs are additive only

### Performance impact:
- High - processing multiple files is inherently slower
- Mitigation:
  - Parallel processing where possible
  - Incremental extraction with caching
  - Smart file ordering
  - Progress reporting

### Memory usage:
- High - need to keep multiple file ASTs in memory
- Mitigation:
  - Process in chunks for large projects
  - Release ASTs after extraction
  - Share common data structures
  - For 1000 files: ~500MB-1GB RAM

## Implementation Priority
Critical - without multi-file support, the extractor cannot be used in real build pipelines. This is the key feature that makes static extraction viable for production use.

## Future Considerations
- Watch mode for development
- Incremental extraction on file changes
- Distributed extraction for large codebases
- Integration with build tool plugins (Webpack, Vite, etc.)
- Streaming API for very large projects
- Cloud-based extraction service